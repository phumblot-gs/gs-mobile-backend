# Architecture

The mobile backend is a thin, stateless AWS Lambda fronted by an API Gateway
HTTP API. It exists to do two things the iOS app can't do safely on its own:

1. Hold the Grand Shooting OAuth `client_secret` (the GS API requires it).
2. Make outbound calls to image-processing providers with API keys we don't
   want shipped to App Store builds.

## High-level diagram

```
+--------+         HTTPS         +---------------+          +-----------+
|  iOS   | --------------------> | API Gateway   | -------> |  Lambda   |
|  app   |                       | HTTP API (v2) |          |  (Hono)   |
+--------+                       +---------------+          +-----+-----+
     ^                                                            |
     |   gsmobile://auth/done?session_id=...                      |
     |                                                            |
     |                            +-------------------------------+
     |                            |
     |   +----------------+   +---v------+   +----------+   +--------------+
     |   | Secrets Mgr    |   |  Dynamo  |   |   S3     |   | Photoroom /  |
     +-->|  - GS OAuth    |   |  - state |   | uploads, |   | Autoretouch  |
         |  - Photoroom   |   |  - sess. |   | packshots|   |   APIs       |
         |  - Autoretouch |   +----------+   +----------+   +--------------+
         +----------------+
```

## Components

- **API Gateway HTTP API**: cheap, low-latency, no VPC. CORS is permissive
  because iOS doesn't enforce CORS for native HTTP, but the OAuth dance runs
  inside an `ASWebAuthenticationSession` WebView so we allow `*` for now.
  TODO: tighten to known origins after launch.
- **Lambda (Node 22, esbuild bundle)**: a single function serves every route
  via Hono. ~512 MB / 30 s on staging, 1 GB / 30 s on production.
- **DynamoDB**: two pay-per-request tables. `oauth-state` holds the CSRF token
  for ~5 min, `oauth-sessions` holds the one-shot token bag for 60 s. TTL is
  set via the `expires_at` attribute on both.
- **S3**: two private buckets. `uploads/` is the dropbox the iOS app PUTs to
  via pre-signed URLs (7-day lifecycle). `packshots/` stores results forever
  (transitions to IA after 30 days).
- **Secrets Manager**: five secrets per environment. Terraform creates the
  resources, the values are seeded manually (or via `scripts/seed-secrets.sh`)
  and ignored on subsequent `terraform apply`.

## Cold-start optimisations

- The Lambda bundle externalises every `@aws-sdk/*` import so it pulls them
  from the Lambda runtime instead of bloating the zip.
- AWS SDK clients are constructed lazily in module-scope helpers and reused
  across warm invocations.
- Secrets Manager calls are memoised in-process (cache the Promise so
  concurrent callers share the round-trip).

## Why not store sessions in the URL fragment?

Because iOS gives us `https://api.mobile.grand-shooting.com/auth/callback` as
the redirect target — by the time we redirect to `gsmobile://...`, the tokens
have already been emitted to a server-side log if we put them in the query.
Stashing them in DynamoDB behind a one-shot 60 s session_id keeps tokens out
of any URL except over a private POST.
