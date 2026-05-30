import { z } from 'zod';

/**
 * Environment variables consumed by the Lambda. We validate them once at
 * cold-start so a missing variable fails fast instead of producing confusing
 * runtime errors later.
 */
const EnvSchema = z.object({
  ENVIRONMENT: z.enum(['development', 'staging', 'production']).default('development'),
  AWS_REGION: z.string().default('eu-west-1'),

  // Resource names (provisioned by Terraform)
  DYNAMO_OAUTH_STATE_TABLE: z.string().min(1),
  DYNAMO_OAUTH_SESSIONS_TABLE: z.string().min(1),
  DYNAMO_ACCOUNT_SETTINGS_POINTER_TABLE: z.string().min(1),
  DYNAMO_ACCOUNT_SETTINGS_VERSION_TABLE: z.string().min(1),
  DYNAMO_ACCOUNT_SETTINGS_RATE_LIMIT_TABLE: z.string().min(1),
  S3_UPLOADS_BUCKET: z.string().min(1),
  S3_PACKSHOTS_BUCKET: z.string().min(1),

  // Public-facing URL used to compute redirect_uri
  PUBLIC_BASE_URL: z.string().url(),
  MOBILE_DEEP_LINK_SCHEME: z.string().default('gsmobile'),

  // Secrets Manager secret IDs
  SECRET_GS_OAUTH_CLIENT_ID: z.string().min(1),
  SECRET_GS_OAUTH_CLIENT_SECRET: z.string().min(1),
  SECRET_GS_OAUTH_BASE_URL: z.string().min(1),
  SECRET_PHOTOROOM_API_KEY: z.string().min(1),
  SECRET_AUTORETOUCH_API_KEY: z.string().min(1),

  // Optional local-dev overrides (skip Secrets Manager round-trip)
  GS_OAUTH_CLIENT_ID: z.string().optional(),
  GS_OAUTH_CLIENT_SECRET: z.string().optional(),
  GS_OAUTH_BASE_URL: z.string().url().optional(),
  PHOTOROOM_API_KEY: z.string().optional(),
  AUTORETOUCH_API_KEY: z.string().optional()
});

export type AppEnv = z.infer<typeof EnvSchema>;

let cached: AppEnv | undefined;

export function getConfig(): AppEnv {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }
  cached = parsed.data;
  return cached;
}

/** Test-only: reset the cached config between tests. */
export function resetConfigCache(): void {
  cached = undefined;
}

/** Convenience: callback URL exposed to GS during the OAuth dance. */
export function getOAuthRedirectUri(cfg = getConfig()): string {
  return `${cfg.PUBLIC_BASE_URL.replace(/\/$/, '')}/auth/callback`;
}

/** Convenience: deep-link the mobile app uses to receive the session id. */
export function getMobileDeepLink(sessionId: string, cfg = getConfig()): string {
  return `${cfg.MOBILE_DEEP_LINK_SCHEME}://auth/done?session_id=${encodeURIComponent(sessionId)}`;
}
