import { z } from 'zod';

// =============================================================================
// OAuth
// =============================================================================

// Mobile client platform initiating the OAuth dance. Defaults to `ios` on the
// server when the query param is missing — existing iOS clients don't send it.
export const PlatformZ = z.enum(['ios', 'android']);
export type Platform = z.infer<typeof PlatformZ>;

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

// GS account membership entry as returned by /v3/account/me. `api_host` is
// the per-tenant shard hostname the client should target for /v3/* calls
// once it's switched to that account.
export const GSAccountZ = z.object({
  account_id: z.number().int(),
  company: z.string(),
  api_host: z.string().optional()
}).passthrough();
export type GSAccount = z.infer<typeof GSAccountZ>;

// Response from GET /v3/account/me on the GS API host. Only the fields we
// use are modelled; the response may contain more. `user_uid` is NOT
// returned by GS today — callers must tolerate its absence.
export const GSMeResponseZ = z.object({
  firstname: z.string().optional(),
  login: z.string().optional(),
  email: z.string().optional(), // GS sometimes returns a login code here, not always RFC-valid
  company: z.string().optional(),
  account_id: z.number().int().optional(),
  user_uid: z.number().int().optional(),
  role: z.string().optional(),
  accounts: z.array(GSAccountZ).optional()
}).passthrough();
export type GSMeResponse = z.infer<typeof GSMeResponseZ>;

export const AuthExchangeResponseZ = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().int().positive(),
  api_base_url: z.string().url(),
  // Identity fields hydrated from GS /me at OAuth-callback time. All optional
  // — a /me failure must not break sign-in.
  email: z.string().optional(),
  account_id: z.number().int().optional(),
  user_uid: z.number().int().optional(),
  user_name: z.string().optional(),
  accounts: z.array(GSAccountZ).optional()
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
  email: z.string().optional(),
  account_id: z.number().int().optional(),
  user_uid: z.number().int().optional(),
  user_name: z.string().optional(),
  accounts: z.array(GSAccountZ).optional()
});
export type AuthRefreshResponse = z.infer<typeof AuthRefreshResponseZ>;

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
  platform?: Platform;
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
  account_id?: number;
  user_uid?: number;
  user_name?: string;
  accounts?: GSAccount[];
  platform?: Platform;
  expires_at: number; // epoch seconds, used as TTL attr
  created_at: number;
}

// =============================================================================
// Account settings sync
// =============================================================================

// The opaque settings payload. The backend doesn't validate keys — the apps own
// the schema. We just enforce "non-empty object" and a size cap.
export const SETTINGS_BLOB_MAX_BYTES = 16384;
export const SETTINGS_HISTORY_CAP_PER_PAIR = 50;

export const SettingsBlobZ = z.record(z.unknown());
export type SettingsBlob = z.infer<typeof SettingsBlobZ>;

export const PutSettingsRequestZ = z.object({
  settings_blob: SettingsBlobZ
});
export type PutSettingsRequest = z.infer<typeof PutSettingsRequestZ>;

export const LastActionZ = z.enum(['push', 'restore']);
export type LastAction = z.infer<typeof LastActionZ>;

// Wire shape of a pointer entry (response from GET /account/settings/{active}
// and POST .../{active}, POST .../restore).
export const SettingsPointerZ = z.object({
  main_account_id: z.number().int(),
  active_account_id: z.number().int(),
  active_account_name: z.string().nullable().optional(),
  current_version_id: z.string(),
  current_version_hash: z.string(),
  updated_at: z.string(),
  updated_by_user_uid: z.number().int(),
  updated_by_user_name: z.string(),
  last_action: LastActionZ,
  last_restored_from_version_id: z.string().nullable(),
  settings_blob: SettingsBlobZ.optional() // included on GET .../{active}, omitted on list
});
export type SettingsPointer = z.infer<typeof SettingsPointerZ>;

export const HistoryItemZ = z.object({
  version_id: z.string(),
  is_current: z.boolean(),
  hash: z.string(),
  created_at: z.string(),
  created_by_user_uid: z.number().int(),
  created_by_user_name: z.string()
});
export type HistoryItem = z.infer<typeof HistoryItemZ>;

export const HistoryVersionDetailZ = HistoryItemZ.extend({
  main_account_id: z.number().int(),
  active_account_id: z.number().int(),
  settings_blob: SettingsBlobZ
});
export type HistoryVersionDetail = z.infer<typeof HistoryVersionDetailZ>;

// DynamoDB items
export interface AccountSettingsPointerRecord {
  main_account_id: number;
  active_account_id: number;
  current_version_id: string;
  updated_at: string;
  updated_by_user_uid: number;
  updated_by_user_name: string;
  last_action: LastAction;
  last_restored_from_version_id: string | null;
}

export interface AccountSettingsVersionRecord {
  account_pair: string; // "<main>#<active>"
  version_id: string;   // ULID
  main_account_id: number;
  active_account_id: number;
  settings_blob: string; // serialised JSON
  settings_hash: string;
  created_at: string;
  created_by_user_uid: number;
  created_by_user_name: string;
  deleted_at: string | null;
  deleted_by_user_uid: number | null;
  deleted_by_user_name: string | null;
}

export interface AccountSettingsRateLimitRecord {
  bucket_key: string;
  count: number;
  window_start: number; // epoch seconds
  expires_at: number;   // epoch seconds (Dynamo TTL)
}
