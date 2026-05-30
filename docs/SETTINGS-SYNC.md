# Account-settings sync

Server side of the centralised app-settings feature. The mobile clients
(iOS + Android) push opaque JSON blobs keyed by `(main_account_id,
active_account_id)`. The backend stores them, keeps an audit trail, and
lets the client list / restore / soft-delete historical versions.

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
│   ├── identity.ts             # /me → ResolvedIdentity, in-memory cache 5 min
│   └── rate-limit.ts           # push 1/5s per (main,active), pull 30/min per user_uid
├── lib/
│   ├── canonical-hash.ts       # RFC 8785 subset, SHA-256 hex
│   ├── settings-dynamo.ts      # pointer + version table accessors, ULID generation
│   ├── rate-limit-dynamo.ts    # atomic UpdateItem on the rate-limit table
│   └── gs-me.ts                # GET /me (strict + best-effort variants)
└── __tests__/
    ├── canonical-hash.test.ts  # fixtures + edge cases
    └── settings.test.ts        # 13 integration tests covering all 7 endpoints
docs/
└── canonical-hash-fixtures.json   # shared fixtures, vendored by mobile clients
```

## DynamoDB tables (provisioned by Terraform)

| Table | PK | SK | TTL | PITR | Purpose |
| --- | --- | --- | --- | --- | --- |
| `account_settings_pointer` | `main_account_id` (N) | `active_account_id` (N) | – | yes | One row per `(main, active)`, points at the current version |
| `account_settings_version` | `account_pair` (S, `"<main>#<active>"`) | `version_id` (S, ULID) | – | yes | All historical versions; soft-deleted entries kept for audit |
| `account_settings_rate_limit` | `bucket_key` (S) | – | `expires_at` (epoch s) | no | Fixed-window counters; TTL evicts stale buckets |

Env vars consumed (set by Terraform via the lambda module):

- `DYNAMO_ACCOUNT_SETTINGS_POINTER_TABLE`
- `DYNAMO_ACCOUNT_SETTINGS_VERSION_TABLE`
- `DYNAMO_ACCOUNT_SETTINGS_RATE_LIMIT_TABLE`

## Identity middleware

`middleware/identity.ts` is applied on every `/account/settings/*` route.

1. Parses `Authorization: Bearer <token>` *or* `access_token <token>`.
   401 if missing/malformed.
2. Looks up the SHA-256 of the token in a module-level `Map` (5-minute
   TTL, lives for the warm lifetime of the Lambda instance).
3. On cache miss: `GET /me` on the GS OAuth host.
   - 401 from GS → 401 to client (token expired; client must refresh).
   - 5xx / malformed → 502 `upstream_error`.
   - Missing `account_id` / `user_uid` / non-empty `accounts[]` → 502.
4. Puts `ResolvedIdentity` on `c.var.identity`.

## Rate limiting

Two flavors, both implemented via a single atomic Dynamo `UpdateItem`:

| Bucket key | Window | Limit |
| --- | --- | --- |
| `pull#<user_uid>` | 60 s | 30 |
| `push#<main>#<active>` | 5 s | 1 |

Fail-open by design: any unexpected Dynamo error logs and lets the
request through. 429 responses include `Retry-After` (seconds) and a
JSON body `{ "code": "rate_limited", "details": { "retry_after_seconds": N } }`.

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
- **`/me` is down** → all `/account/settings/*` return 502. OAuth flow
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
