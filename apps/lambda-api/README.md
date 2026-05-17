# @gs-mobile-backend/lambda-api

Single AWS Lambda (Node 22) fronted by an API Gateway HTTP API. All routes are
served by one Hono app bundled by esbuild.

## Routes

| Method | Path              | Handler                          |
| -----: | ----------------- | -------------------------------- |
| GET    | `/health`         | inline                           |
| GET    | `/auth/start`     | `handlers/auth-start.ts`         |
| GET    | `/auth/callback`  | `handlers/auth-callback.ts`      |
| POST   | `/auth/exchange`  | `handlers/auth-exchange.ts`      |
| POST   | `/auth/refresh`   | `handlers/auth-refresh.ts`       |
| POST   | `/upload/init`    | `handlers/upload-init.ts`        |
| POST   | `/packshot`       | `handlers/packshot.ts`           |

## Local dev

```bash
cp ../../env.development.example .env  # or export the vars
pnpm dev
```

The local entry point (`src/local-server.ts`) starts an HTTP server on
`localhost:3000`. AWS calls still hit real AWS — supply `AWS_PROFILE` or
override secrets inline via `GS_OAUTH_CLIENT_ID` etc.

## Build

```bash
pnpm build     # esbuild bundle -> dist/index.js
pnpm package   # zips dist/index.js -> lambda-api.zip
```

The CI workflow does both and pushes the zip with `aws lambda update-function-code`.
