# Local dev

## Prerequisites

- Node.js 22 (`nvm use` honours `.nvmrc`)
- pnpm 8+
- AWS CLI with credentials that can read the staging secrets (or skip secrets
  altogether by inlining values via env vars — see below)

## Setup

```bash
git clone <repo> gs-mobile-backend
cd gs-mobile-backend
pnpm install
cp env.development.example .env
```

## Inline secrets (skip Secrets Manager)

The simplest way to develop without AWS roundtrips is to add the inline
override env vars to your `.env`:

```
GS_OAUTH_CLIENT_ID=<dev client id>
GS_OAUTH_CLIENT_SECRET=<dev client secret>
GS_OAUTH_BASE_URL=https://api-19.grand-shooting.com
PHOTOROOM_API_KEY=<sandbox key>
AUTORETOUCH_API_KEY=<sandbox key>
```

When set, the Lambda code skips `secretsmanager:GetSecretValue` and uses the
inline value directly (see `apps/lambda-api/src/lib/secrets.ts`).

## DynamoDB / S3

For full local development without AWS, you can either:

1. Point at real AWS resources using staging credentials
   (`AWS_PROFILE=gs-staging`), which is the simplest option.
2. Run `dynamodb-local` and `minio` — left as an exercise; the SDK clients
   accept `endpoint` overrides but we don't wire that up yet.

## Run

```bash
pnpm dev
# -> http://localhost:3000/health
# -> http://localhost:3000/auth/start
```

The dev entry point is `apps/lambda-api/src/local-server.ts`. It spins up a
plain Node HTTP server backed by the same Hono app the Lambda exports.

## Test

```bash
pnpm test
# or specific package:
pnpm --filter @gs-mobile-backend/lambda-api test
```

## Lint / Typecheck

```bash
pnpm lint
pnpm typecheck
```
