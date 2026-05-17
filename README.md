# gs-mobile-backend

AWS backend for the Grand Shooting iOS mobile app. Single Lambda (Node 22)
behind API Gateway HTTP API. Does two things:

1. **OAuth proxy** — holds the Grand Shooting `client_secret` so the iOS app
   can complete the Authorization Code flow without shipping the secret.
2. **Packshot processing** — receives an image upload key, dispatches to a
   provider (Photoroom or Autoretouch), stores the result in S3, returns a
   short-lived URL.

## Layout

```
gs-mobile-backend/
├── apps/lambda-api/                # Hono + Lambda handler (esbuild bundle)
├── packages/core/                  # Shared Zod schemas + error classes
├── packages/sdk/                   # (Placeholder) TS client SDK
├── infrastructure/terraform/       # Modules + per-env stacks (staging, production)
├── .github/workflows/              # CI + deploy-staging + deploy-production
├── docs/                           # ARCHITECTURE, AUTH-FLOW, LOCAL-DEV
└── scripts/                        # invoke-local.sh, seed-secrets.sh
```

## Endpoints

| Method | Path             | Purpose                                      |
| -----: | ---------------- | -------------------------------------------- |
| GET    | `/health`        | health probe                                 |
| GET    | `/auth/start`    | begin OAuth flow (redirects to GS)           |
| GET    | `/auth/callback` | OAuth redirect target; redirects to gsmobile:// |
| POST   | `/auth/exchange` | one-shot swap of session_id for tokens       |
| POST   | `/auth/refresh`  | refresh access token via refresh_token       |
| POST   | `/upload/init`   | get a presigned PUT URL                      |
| POST   | `/packshot`      | process an uploaded image                    |

## Local dev (3-5 steps from clone)

```bash
# 1. clone + install
git clone <repo> gs-mobile-backend && cd gs-mobile-backend
pnpm install

# 2. copy env file
cp env.development.example .env
# (optionally fill in GS_OAUTH_CLIENT_ID, ..._SECRET, GS_OAUTH_BASE_URL,
#  PHOTOROOM_API_KEY, AUTORETOUCH_API_KEY to skip Secrets Manager)

# 3. configure AWS creds (only needed if you don't inline the secrets)
export AWS_PROFILE=gs-staging
export AWS_REGION=eu-west-1

# 4. run the dev server
pnpm dev
# -> http://localhost:3000/health

# 5. run tests
pnpm test
```

See [docs/LOCAL-DEV.md](docs/LOCAL-DEV.md) for more.

## Deploy (first-time setup)

### 1. Bootstrap Terraform state backend (one-time, manual)

Create the S3 bucket and DynamoDB lock table referenced by
`infrastructure/terraform/environments/*/backend.tf` (only required once per
AWS account):

```bash
aws s3api create-bucket \
  --bucket gs-mobile-terraform-state \
  --region eu-west-1 \
  --create-bucket-configuration LocationConstraint=eu-west-1

aws s3api put-bucket-versioning \
  --bucket gs-mobile-terraform-state \
  --versioning-configuration Status=Enabled

aws dynamodb create-table \
  --table-name gs-mobile-terraform-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region eu-west-1
```

### 2. Configure GitHub Actions secrets

In the repo settings, add:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

The IAM user behind those credentials needs lambda/apigateway/dynamodb/s3/secretsmanager
permissions plus access to the Terraform state bucket and lock table.

### 3. First Terraform apply (manual)

```bash
cd infrastructure/terraform/environments/staging
terraform init
terraform plan
terraform apply
```

This creates the Lambda (with a placeholder zip), DynamoDB tables, S3 buckets,
Secrets Manager entries (with `REPLACE_ME` placeholders), and API Gateway.

### 4. Seed secrets

```bash
ENV=staging ./scripts/seed-secrets.sh
```

The script prompts interactively for each secret value. Required values:

- `gs-mobile/staging/gs-oauth-client-id` — from Grand Shooting plugin admin
- `gs-mobile/staging/gs-oauth-client-secret` — from Grand Shooting plugin admin
- `gs-mobile/staging/gs-oauth-base-url` — e.g. `https://api-19.grand-shooting.com`
- `gs-mobile/staging/photoroom-api-key` — from Photoroom dashboard
- `gs-mobile/staging/autoretouch-api-key` — from Autoretouch dashboard

### 5. Configure DNS (custom domain)

After `terraform apply`, grab the outputs:

```bash
terraform output api_custom_domain_target
terraform output acm_validation_records
```

- Add the ACM validation CNAMEs to your DNS.
- Once the cert is validated, add a CNAME for `api-staging.mobile.grand-shooting.com`
  pointing at `api_custom_domain_target`.

### 6. Push to `staging` to deploy

```bash
git push origin staging
```

The `Deploy Staging` workflow will run terraform, build the Lambda, and
update the function code.

### 7. Same for production

Repeat steps 3–6 inside `infrastructure/terraform/environments/production`,
and push to the `production` branch.

## Env vars expected by the Lambda

See `apps/lambda-api/src/lib/config.ts` for the Zod schema. Required:

| Var                              | Notes                                  |
| -------------------------------- | -------------------------------------- |
| `ENVIRONMENT`                    | `development | staging | production`   |
| `AWS_REGION`                     | `eu-west-1`                            |
| `DYNAMO_OAUTH_STATE_TABLE`       | DynamoDB table name                    |
| `DYNAMO_OAUTH_SESSIONS_TABLE`    | DynamoDB table name                    |
| `S3_UPLOADS_BUCKET`              | uploads bucket name                    |
| `S3_PACKSHOTS_BUCKET`            | packshots bucket name                  |
| `PUBLIC_BASE_URL`                | e.g. `https://api.mobile.grand-shooting.com` |
| `MOBILE_DEEP_LINK_SCHEME`        | iOS scheme (default `gsmobile`)        |
| `SECRET_GS_OAUTH_CLIENT_ID`      | Secrets Manager secret ID              |
| `SECRET_GS_OAUTH_CLIENT_SECRET`  | Secrets Manager secret ID              |
| `SECRET_GS_OAUTH_BASE_URL`       | Secrets Manager secret ID              |
| `SECRET_PHOTOROOM_API_KEY`       | Secrets Manager secret ID              |
| `SECRET_AUTORETOUCH_API_KEY`     | Secrets Manager secret ID              |

Optional (for local dev — bypasses Secrets Manager): `GS_OAUTH_CLIENT_ID`,
`GS_OAUTH_CLIENT_SECRET`, `GS_OAUTH_BASE_URL`, `PHOTOROOM_API_KEY`,
`AUTORETOUCH_API_KEY`.

## Conventions

- pnpm monorepo (`pnpm-workspace.yaml`), Node 22, TypeScript strict.
- Hono for HTTP routing, Zod for validation, esbuild for Lambda bundling.
- AWS SDK v3 (`@aws-sdk/*`).
- Terraform 1.13.0, AWS provider 5.x, eu-west-1 region, account 980539927939.
- S3 backend for Terraform state, DynamoDB for lock.

See [docs/](docs/) for architecture and auth flow diagrams.
