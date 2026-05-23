# Auth flow

The Grand Shooting API speaks OAuth2 Authorization Code, **and requires a
`client_secret`**. Because we can't ship the secret in the iOS app, this
backend acts as a confidential client. The iOS app starts the dance, the
backend completes it, and the backend hands tokens back to the app via a
one-shot session id.

## Sequence

```mermaid
sequenceDiagram
  participant iOS as iOS app
  participant ASW as ASWebAuthenticationSession
  participant API as Mobile backend
  participant Dyn as DynamoDB
  participant GS as Grand Shooting

  iOS->>ASW: open(start_url)
  ASW->>API: GET /auth/start
  API->>API: state = randomBytes(32)
  API->>Dyn: put OAuth state (TTL 5min)
  API-->>ASW: 302 -> GS authorize URL
  ASW->>GS: GET /oauth/default/authorize
  GS->>ASW: user logs in
  GS-->>ASW: 302 /auth/callback?code&state
  ASW->>API: GET /auth/callback?code&state
  API->>Dyn: consume state (one-shot)
  API->>GS: POST /oauth/default/token (code, client_secret)
  GS-->>API: { access_token, refresh_token, expires_in }
  API->>API: session_id = randomBytes(32)
  API->>Dyn: put session (TTL 60s)
  API-->>ASW: 302 gsmobile://auth/done?session_id
  ASW-->>iOS: deep link delivered
  iOS->>API: POST /auth/exchange { session_id }
  API->>Dyn: consume session (one-shot)
  API-->>iOS: { access_token, refresh_token, expires_in, api_base_url, email? }
```

After the token exchange the backend also calls `GET /oauth/default/userinfo`
(the standard OIDC endpoint) with the freshly minted access token to retrieve
the user's email. The email is persisted alongside the tokens in the
short-lived session record and surfaced in the `/auth/exchange` response.
The lookup is best-effort: if it fails (404, network error, malformed body)
the sign-in still completes — `email` is simply omitted. The iOS client
treats it as optional and falls back to "non-staff" gating in that case.

## Refresh

```mermaid
sequenceDiagram
  participant iOS as iOS app
  participant API as Mobile backend
  participant GS as Grand Shooting

  iOS->>API: POST /auth/refresh { refresh_token }
  API->>GS: POST /oauth/default/token (grant_type=refresh_token, client_secret)
  GS-->>API: { access_token, refresh_token?, expires_in }
  API->>GS: GET /oauth/default/userinfo (Bearer access_token)
  GS-->>API: { email?, sub, ... }
  API-->>iOS: { access_token, refresh_token?, expires_in, email? }
```

The userinfo round-trip on every refresh keeps `email` available for cold
launches where only a refresh token is stored in the Keychain. As with the
exchange flow, a userinfo failure does not abort the refresh.

## Security notes

- `state` is 32 random bytes (256 bits), hex-encoded.
- `session_id` is 32 random bytes — it lives for at most 60 seconds and is
  consumed on first read. Replays return 401.
- The backend never returns tokens via a URL query string; only via the
  `POST /auth/exchange` response body, over TLS.
- `client_secret` is fetched from Secrets Manager on cold start and cached in
  memory. It never appears in CloudWatch logs (we redact via structured
  logging — TODO: verify with a log filter test in staging).

## Open TODOs

- Derive the per-tenant API shard URL (`api-34.grand-shooting.com`) from the
  access token claims or a `GET /me` call instead of hardcoding to the OAuth
  base URL.
- Consider PKCE on top of state, even though our backend already holds the
  client_secret — it's belt-and-braces protection against backend
  compromise.
