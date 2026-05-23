import { z } from 'zod';

// =============================================================================
// OAuth
// =============================================================================

export const OAuthTokenResponseZ = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  token_type: z.string().optional(),
  expires_in: z.number().int().positive(),
  scope: z.string().optional()
});
export type OAuthTokenResponse = z.infer<typeof OAuthTokenResponseZ>;

export const AuthExchangeRequestZ = z.object({
  session_id: z.string().min(16).max(128)
});
export type AuthExchangeRequest = z.infer<typeof AuthExchangeRequestZ>;

export const AuthExchangeResponseZ = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().int().positive(),
  api_base_url: z.string().url(),
  // Email of the authenticated GS user. The iOS app uses it to gate dev-only
  // UI (e.g. the staging picker) on @grand-shooting.com addresses. Optional
  // so a userinfo lookup failure doesn't break the sign-in flow.
  email: z.string().email().optional()
});
export type AuthExchangeResponse = z.infer<typeof AuthExchangeResponseZ>;

export const AuthRefreshRequestZ = z.object({
  refresh_token: z.string().min(1)
});
export type AuthRefreshRequest = z.infer<typeof AuthRefreshRequestZ>;

export const AuthRefreshResponseZ = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().int().positive(),
  email: z.string().email().optional()
});
export type AuthRefreshResponse = z.infer<typeof AuthRefreshResponseZ>;

// OIDC userinfo response from /oauth/default/userinfo. We only model the fields
// we care about; GS may return many more claims.
export const OIDCUserInfoZ = z.object({
  sub: z.string().optional(),
  email: z.string().email().optional(),
  preferred_username: z.string().optional()
}).passthrough();
export type OIDCUserInfo = z.infer<typeof OIDCUserInfoZ>;

// =============================================================================
// Upload
// =============================================================================

export const UploadInitRequestZ = z.object({
  content_type: z
    .string()
    .min(1)
    .refine((v) => /^[a-z]+\/[a-zA-Z0-9.+-]+$/i.test(v), 'Invalid MIME type'),
  filename: z.string().min(1).max(255)
});
export type UploadInitRequest = z.infer<typeof UploadInitRequestZ>;

export const UploadInitResponseZ = z.object({
  upload_url: z.string().url(),
  upload_key: z.string(),
  expires_at: z.string()
});
export type UploadInitResponse = z.infer<typeof UploadInitResponseZ>;

// =============================================================================
// Packshot
// =============================================================================

export const PackshotProviderNameZ = z.enum(['photoroom', 'autoretouch']);
export type PackshotProviderName = z.infer<typeof PackshotProviderNameZ>;

export const PackshotRequestZ = z.object({
  upload_key: z.string().min(1),
  provider: PackshotProviderNameZ.optional().default('photoroom'),
  workflow_id: z.string().optional()
});
export type PackshotRequest = z.infer<typeof PackshotRequestZ>;

export const PackshotResponseZ = z.object({
  result_url: z.string().url(),
  provider: PackshotProviderNameZ,
  took_ms: z.number().int().nonnegative()
});
export type PackshotResponse = z.infer<typeof PackshotResponseZ>;

// =============================================================================
// Persisted records (DynamoDB)
// =============================================================================

export interface OAuthStateRecord {
  state: string;
  expires_at: number; // epoch seconds, used as TTL attr
  created_at: number;
}

export interface OAuthSessionRecord {
  session_id: string;
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  api_base_url: string;
  email?: string;
  expires_at: number; // epoch seconds, used as TTL attr
  created_at: number;
}
