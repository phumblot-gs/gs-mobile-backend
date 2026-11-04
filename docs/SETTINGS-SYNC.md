# Account-settings sync

Server side of the centralised app-settings feature. The mobile clients
(iOS + Android) push opaque JSON blobs keyed by `(main_account_id,
active_account_id)`. The backend stores them, keeps an audit trail, and
lets the client list / restore / soft-delete historical versions.

The same API serves every Grand Shooting instance: the multi-tenant one
(`shared`) and dedicated ones (e.g. `gl`), selected by the `X-GS-Env`
request header — see [Multi-instance](#multi-instance-x-gs-env).

The wire contract is locked down in
[`gs-android/BACKEND_SETTINGS_SYNC.v3.md`](../../gs-android/BACKEND_SETTINGS_SYNC.v3.md)
— **that document is the source of truth for the API shape**. This file
covers the **implementation map** for someone landing in this repo.

---

## Code layout

```
apps/lambda-api/src/
├── handlers/settings/
│   └── index.ts                # 7 endpoints (list / get / push / history / restore / delete)
├── middleware/
│   ├── identity.ts             # X-GS-Env + /me → ResolvedIdentity, in-memory cache 5 min
│   ├── require-admin.ts        # DISABLED — not wired (GS /me exposes no role); see "Admin role gate"
│   └── rate-limit.ts           # push 1/5s per (main,active), pull 30/min per user_uid
├── lib/
│   ├── canonical-hash.ts       # RFC 8785 subset, SHA-256 hex
│   ├── settings-dynamo.ts      # pointer + version table accessors, ULID generation
│   ├── rate-limit-dynamo.ts    # atomic UpdateItem on the rate-limit table
│   ├── gs-instances.ts         # registry of GS instances (X-GS-Env → api_base_url)
│   └── gs-me.ts                # GET /me (strict + best-effort variants), relays the auth scheme
└── __tests__/
    ├── canonical-hash.test.ts  # fixtures + edge cases
    ├── gs-instances.test.ts    # registry validation, env ids, partition keys
    └── settings.test.ts        # integration tests: 7 endpoints + multi-instance
docs/
└── canonical-hash-fixtures.json   # shared fixtures, vendored by mobile clients
```

## DynamoDB tables (provisioned by Terraform)

| Table | PK | SK | TTL | PITR | Purpose |
| --- | --- | --- | --- | --- | --- |
| `account_settings_pointer` | `main_account_id` (N) | `active_account_id` (N) | – | yes | `shared` instance: one row per `(main, active)`, points at the current version |
| `account_settings_env_pointer` | `env_main` (S, `"<env>#<main>"`) | `active_account_id` (N) | – | yes | Same, for **dedicated** instances (all of them) |
| `account_settings_version` | `account_pair` (S, `"<main>#<active>"`, or `"<env>#<main>#<active>"` for a dedicated instance) | `version_id` (S, ULID) | – | yes | All historical versions; soft-deleted entries kept for audit |
| `account_settings_rate_limit` | `bucket_key` (S) | – | `expires_at` (epoch s) | no | Fixed-window counters; TTL evicts stale buckets |

Env vars consumed (set by Terraform via the lambda module):

- `DYNAMO_ACCOUNT_SETTINGS_POINTER_TABLE`
- `DYNAMO_ACCOUNT_SETTINGS_VERSION_TABLE`
- `DYNAMO_ACCOUNT_SETTINGS_RATE_LIMIT_TABLE`
- `DYNAMO_ACCOUNT_SETTINGS_ENV_POINTER_TABLE` (optional: without it, writes
  on a dedicated instance fail with 500; `shared` is unaffected)
- `SECRET_GS_INSTANCES` (optional: without it, only `shared` exists)

## Identity middleware

`middleware/identity.ts` is applied on every `/account/settings/*` route.

1. Reads `X-GS-Env` (absent = `shared`) and resolves it against the
   instance registry. 400 `unknown_env` if unknown — checked before the
   credentials.
2. Parses `Authorization: Bearer <token>` *or* `access_token <token>`,
   **keeping the scheme**. 401 if missing/malformed.
3. Looks up the SHA-256 of `(env, scheme, token)` in a module-level `Map`
   (5-minute TTL, lives for the warm lifetime of the Lambda instance).
4. On cache miss: `GET /v3/account/me` on the instance's `api_base_url`,
   with **the same scheme the client sent** (see
   [Auth schemes](#auth-schemes)).
   - 4xx from GS (401/403/404) → 401 to client (token rejected; client
     must refresh). GS returns 404 for an invalid token, hence the
     wide mapping.
   - 5xx / malformed → 502 `upstream_error`.
   - Missing `account_id` or empty `accounts[]` → 502.
5. **`user_uid` fallback** : the real GS payload doesn't expose
   `user_uid` today. The middleware falls back to `account_id` as the
   stable identifier for audit fields and the per-user rate-limit key.
   Consequence: pull rate limit becomes per-tenant rather than
   per-individual-user until GS surfaces `user_uid`.
6. Puts `ResolvedIdentity` (incl. `env` and `role`) on `c.var.identity`.

## Admin role gate — DISABLED

`middleware/require-admin.ts` exists but is **not wired up** in `index.ts`.

It was meant to reject with `403 not_admin` when `identity.role !== "admin"`,
reading the role from the `role` field of GS `/v3/account/me`. **But GS does
not expose a `role` field** — verified against the live API on 2026-06-16, the
payload is only `firstname / lastname / login / email / company / avatar /
account_id / accounts[]` (and `accounts[].prefs`, which is catalog display
config). With `role` always absent, `identity.role` was always `undefined` and
the gate returned `403 not_admin` for **every** caller, admins included — the
same gap already documented for `user_uid`.

The gate is therefore disabled: every authenticated caller with access to the
account may read and push settings (the pre-§6 behaviour).

**To re-enable:** un-comment the two `app.use('/account/settings...',
requireAdmin)` lines in `index.ts`, but only **after** GS surfaces a role on
`/me` — and re-verify the actual field name and value against the live payload
first (don't assume it's literally `role === "admin"`).

## Rate limiting

Two flavors, both implemented via a single atomic Dynamo `UpdateItem`:

| Bucket key | Window | Limit |
| --- | --- | --- |
| `pull#<user_uid>` | 60 s | 30 |
| `push#<main>#<active>` | 5 s | 1 |

On a dedicated instance the key is prefixed with the env id
(`gl#pull#16`, `gl#push#16#957`); `shared` keeps the keys above.

Fail-open by design: any unexpected Dynamo error logs and lets the
request through. 429 responses include `Retry-After` (seconds) and a
JSON body `{ "code": "rate_limited", "details": { "retry_after_seconds": N } }`.

## Multi-instance (`X-GS-Env`)

The mobile app can sign in to a **dedicated** Grand Shooting instance (e.g.
`gl`, API `https://api-gl.grand-shooting.com`) with a personal API key. Each
instance has its own users and keys, and **`account_id`s are not unique
across instances**.

### The header

```
X-GS-Env: gl
Authorization: Bearer <personal API key of the gl instance>
```

| `X-GS-Env` | Behaviour |
| --- | --- |
| absent / empty | `shared` — **exactly the pre-existing behaviour** (same GS host, same Dynamo keys). The registry secret isn't even read. |
| `shared` | same as absent |
| a registered env id (`gl`, …) | `/me` is called on that instance's `api_base_url`; settings and rate limits live in that instance's partition |
| anything else | `400 { "code": "unknown_env" }`, GS is never called |

The value is trimmed and lower-cased. Env ids match `^[a-z][a-z0-9-]{0,31}$`.
It applies to every `/account/settings*` route. `/auth/*` (OAuth) is still
`shared`-only: OAuth isn't available on dedicated instances yet (phase 2).

### Auth schemes

GS accepts two schemes, and they are **not interchangeable**:

- `access_token <token>` — OAuth-issued token (what `/auth/exchange` returns).
- `Bearer <key>` — personal API key.

The backend relays to `/me` exactly the scheme the client sent (case is
normalised: `bearer` → `Bearer`). Before this, every token was relayed as
`access_token`, so an API key was rejected even on `shared`.

### Instance registry

Secret `gs-mobile/<env>/gs-instances` (override locally with
`GS_INSTANCES_JSON`), a JSON object keyed by env id:

```json
{
  "gl": {
    "api_base_url": "https://api-gl.grand-shooting.com",
    "web_base_url": "https://gl.grand-shooting.com",
    "oauth_client_id": "…",
    "oauth_client_secret": "…"
  }
}
```

- `api_base_url` and `web_base_url` are required for dedicated instances.
  They must be `https` origins (no path, query or credentials; `http` is
  only accepted when `ENVIRONMENT=development`).
- `oauth_client_id` / `oauth_client_secret` are optional and unused for
  now — they're for multi-instance OAuth (phase 2).
- `shared` **must not** be declared: it is always built from the existing
  `gs-oauth-base-url` / `gs-oauth-client-*` secrets (its `web_base_url` is
  optional and unset today).
- Validation is strict: one invalid entry makes the whole registry invalid
  (500 on dedicated instances, logged; `shared` keeps working). Seed it with
  `scripts/seed-secrets.sh`, which refuses non-object JSON.
- Terraform creates the secret with `{}` and never overwrites its value.

**SSRF:** the client only sends an id. The host we call always comes from
this closed list. An unknown id is a 400, never a fallback to `shared` or to
a client-supplied URL.

### Partitioning (why two pointer tables)

Since `account_id` 16 on `shared` and `account_id` 16 on `gl` are two
different accounts, every key is scoped by env:

| Data | `shared` (unchanged, no migration) | Dedicated instance |
| --- | --- | --- |
| Versions (`account_pair`, S) | `16#957` | `gl#16#957` |
| Pointers | `account_settings_pointer`, PK `main_account_id` (N) | `account_settings_env_pointer`, PK `env_main` = `gl#16` (S) |
| Rate limit (`bucket_key`, S) | `pull#16`, `push#16#957` | `gl#pull#16`, `gl#push#16#957` |

The pointer table's PK is numeric and can't carry a prefix; hence one extra
table common to every dedicated instance (rather than one table per instance,
or a migration of the existing data). Prefixed keys can't collide with
`shared` ones: `shared` keys start with a digit (or with `pull#`/`push#`
followed by a digit), env ids start with a letter and can't be `shared`.
Dedicated-instance items also carry an `env` attribute for auditing.
Everything goes through `pairKey` / `pointerLocation` in
`lib/settings-dynamo.ts` and `bucketKey` in `middleware/rate-limit.ts`.

### Adding an instance

1. Add its entry to `gs-mobile/<env>/gs-instances` (seed script or console).
2. Wait for warm Lambda instances to recycle, or force a cold start (e.g.
   re-deploy): the secret is cached for the lifetime of a container.

## Push / no-op / purge logic

`POST /account/settings/{active}` flow:

1. Canonicalise `settings_blob` (sorted keys, no whitespace, RFC 8785).
2. Reject if `> 16 KB` (413 `blob_too_large`).
3. Compute SHA-256 hex.
4. Read current pointer + current version. If hash matches → **no-op**,
   return existing pointer unchanged.
5. Otherwise `TransactWriteItems`:
   - `Put` new version row (ULID generated server-side).
   - `Put` updated pointer with `last_action: "push"`,
     `last_restored_from_version_id: null`.
6. **Purge** : query all live versions for the pair; if > 50, hard-delete
   the oldest (by ULID, =creation order), but never the new current. Done
   outside the transaction — purge race is acceptable.

## Restore / soft delete

- `POST .../history/{ulid}/restore` writes a single `PutItem` on the
  pointer with `last_action: "restore"` and `last_restored_from_version_id`
  set. No new version row.
- `DELETE .../history/{ulid}` is a soft delete — sets `deleted_at` on the
  version row. The version disappears from `GET .../history`, returns
  404 on `GET .../history/{ulid}`, and is excluded from the 50-version
  retention quota.

## Canonical hash

`lib/canonical-hash.ts` implements RFC 8785 (JCS) — minimal subset
sufficient for our payloads. The fixtures in
`docs/canonical-hash-fixtures.json` are the contract:

- Each case has the input, the expected canonical string, and the
  expected SHA-256 hex.
- The `migration-ping-pong-guard` case validates that a client that
  receives a blob with an unknown key, modifies a *different* key, and
  pushes back the union, still produces the right hash.
- The fixtures are vendored into
  `gs-android/.../test/resources/canonical-hash-fixtures.json` and
  `gs-ios/.../Tests/Resources/canonical-hash-fixtures.json` so any
  algorithm drift gets caught on the mobile CI.

To regenerate the fixtures after an algorithm change:

```bash
node -e "
  import('./apps/lambda-api/src/lib/canonical-hash.ts').then(m => {
    // … rebuild docs/canonical-hash-fixtures.json with current outputs
  })
" # or just edit by hand and re-run apps/lambda-api/src/__tests__/canonical-hash.test.ts
```

## Operations cheat-sheet

- **A user opens Settings** → at most 1 `/me` per warm Lambda instance
  per 5 min, plus 1 `GetItem` per pointer in `GET /account/settings`,
  plus one more on the active pair.
- **A user changes a setting** → POST = 1 `GetItem` + 1 `GetItem` for
  the current version + (no-op) or (TransactWriteItems = 2 writes + 1
  Query + N hard-deletes for purge).
- **`/me` is down** → all `/account/settings/*` return 502 (per instance:
  `api-gl` being down only affects `X-GS-Env: gl`). OAuth flow
  is unaffected (it does a best-effort `/me` call).
- **Dynamo rate-limit table is down** → fail-open; settings still work.
- **Token revoked at GS** → up to 5 min of cached identity continues to
  succeed. Acceptable, documented in
  [`gs-android/BACKEND_SETTINGS_SYNC.v3.md`](../../gs-android/BACKEND_SETTINGS_SYNC.v3.md) §1.4.

## Out of scope (intentionally)

- No admin role check yet — every authenticated user with access to a
  given `active_account_id` can push/restore/delete. See
  [§5 of the spec](../../gs-android/BACKEND_SETTINGS_SYNC.v3.md) for the
  hardening plan.
- No webhook on settings change.
- No GSI on `account_settings_version` — `Query` by `account_pair` is the
  only access pattern we support today.
