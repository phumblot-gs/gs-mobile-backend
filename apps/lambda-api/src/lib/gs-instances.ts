import { z } from 'zod';
import { AppError, InternalError } from '@gs-mobile-backend/core';
import { getConfig } from './config.js';
import { getSecret, getSecretOrEnv } from './secrets.js';

/**
 * Registry of the Grand Shooting instances the mobile backend may talk to.
 *
 * - `shared` is the multi-tenant instance. It is ALWAYS built from the
 *   pre-existing secrets (`gs-oauth-base-url`, `gs-oauth-client-id`,
 *   `gs-oauth-client-secret`) and never reads the registry secret — so
 *   callers that don't send `X-GS-Env` keep working even if the registry
 *   secret is missing, malformed, or not readable yet.
 * - Dedicated instances (e.g. `gl` → https://api-gl.grand-shooting.com) live
 *   in a JSON secret (`gs-mobile/<env>/gs-instances`, override with
 *   `GS_INSTANCES_JSON` locally):
 *
 *     { "<env_id>": { "api_base_url": "...", "web_base_url": "...",
 *                     "oauth_client_id"?: "...", "oauth_client_secret"?: "..." } }
 *
 *   The OAuth credentials are optional and unused in phase 1 (API keys only);
 *   phase 2 (`/auth/start?env=…`) will read them through `resolveInstance`.
 *
 * SSRF: the client only ever sends an env id. The host we call always comes
 * from this closed list; an unknown id is a 400, never a fallback.
 */

export const SHARED_ENV = 'shared';

/** Env ids: lowercase, start with a letter (so prefixed Dynamo keys can't collide with `shared` numeric keys). */
const ENV_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

export interface GsInstance {
  envId: string;
  /** Origin of the GS API (scheme://host[:port], no path). */
  apiBaseUrl: string;
  /** GS web front. Required for dedicated instances, optional for `shared`. */
  webBaseUrl?: string;
  /** Phase 2. For `shared` these stay in the existing dedicated secrets. */
  oauthClientId?: string;
  oauthClientSecret?: string;
}

export class UnknownEnvError extends AppError {
  constructor(envId: string) {
    super(`Unknown GS environment: ${envId}`, 400, 'unknown_env', { env: envId });
    this.name = 'UnknownEnvError';
  }
}

function allowsHttp(): boolean {
  return getConfig().ENVIRONMENT === 'development';
}

/** An http(s) URL reduced to its origin; rejects paths, query, fragment and credentials. */
function originOnlyUrl(field: string) {
  return z
    .string()
    .url()
    .superRefine((raw, ctx) => {
      const u = new URL(raw);
      const okProto = u.protocol === 'https:' || (u.protocol === 'http:' && allowsHttp());
      if (!okProto) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${field} must be https` });
      if (u.username || u.password) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${field} must not carry credentials` });
      if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${field} must be an origin (no path/query/fragment)` });
      }
    })
    .transform((raw) => new URL(raw).origin);
}

const InstanceEntryZ = z
  .object({
    api_base_url: originOnlyUrl('api_base_url'),
    web_base_url: originOnlyUrl('web_base_url'),
    oauth_client_id: z.string().min(1).optional(),
    oauth_client_secret: z.string().min(1).optional()
  })
  .strict();

const RegistryZ = z.record(z.string(), z.unknown());

/**
 * Parses and validates the registry JSON. Strict: any invalid entry rejects
 * the whole registry (fail closed — a typo must surface, not silently drop an
 * instance). Exported for tests.
 */
export function parseRegistry(raw: string): Map<string, GsInstance> {
  const trimmed = raw.trim();
  // Terraform placeholder / unseeded secret → empty registry.
  if (trimmed === '' || trimmed === 'REPLACE_ME') return new Map();

  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    throw new Error('GS instance registry is not valid JSON');
  }
  const top = RegistryZ.safeParse(json);
  if (!top.success || Array.isArray(json)) {
    throw new Error('GS instance registry must be a JSON object');
  }

  const out = new Map<string, GsInstance>();
  for (const [envId, value] of Object.entries(top.data)) {
    if (envId === SHARED_ENV) {
      throw new Error(`"${SHARED_ENV}" must not be declared in the registry (it uses the existing secrets)`);
    }
    if (!ENV_ID_RE.test(envId)) {
      throw new Error(`Invalid env id in registry: ${JSON.stringify(envId)}`);
    }
    const entry = InstanceEntryZ.safeParse(value);
    if (!entry.success) {
      // Never log the entry itself: it may hold an OAuth client secret.
      throw new Error(
        `Invalid registry entry "${envId}": ${entry.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
      );
    }
    out.set(envId, {
      envId,
      apiBaseUrl: entry.data.api_base_url,
      webBaseUrl: entry.data.web_base_url,
      oauthClientId: entry.data.oauth_client_id,
      oauthClientSecret: entry.data.oauth_client_secret
    });
  }
  return out;
}

let parsedCache: { raw: string; registry: Map<string, GsInstance> } | undefined;

/** Test-only. */
export function _resetInstanceRegistryCache(): void {
  parsedCache = undefined;
}

async function loadRegistry(): Promise<Map<string, GsInstance>> {
  const cfg = getConfig();
  let raw: string;
  if (cfg.GS_INSTANCES_JSON !== undefined && cfg.GS_INSTANCES_JSON.length > 0) {
    raw = cfg.GS_INSTANCES_JSON;
  } else if (cfg.SECRET_GS_INSTANCES) {
    try {
      raw = await getSecret(cfg.SECRET_GS_INSTANCES);
    } catch (err) {
      console.error('[gs-instances] registry secret unreadable', { error: (err as Error).name });
      throw new InternalError('GS instance registry unavailable');
    }
  } else {
    // Not provisioned yet (code deployed before Terraform): no dedicated instance.
    return new Map();
  }

  if (parsedCache && parsedCache.raw === raw) return parsedCache.registry;
  let registry: Map<string, GsInstance>;
  try {
    registry = parseRegistry(raw);
  } catch (err) {
    console.error('[gs-instances] invalid registry', { message: (err as Error).message });
    throw new InternalError('GS instance registry is misconfigured');
  }
  parsedCache = { raw, registry };
  return registry;
}

/**
 * Normalises a client-supplied env id (`X-GS-Env`). Absent/empty → `shared`.
 * Throws `UnknownEnvError` (400) on a malformed id. Does NOT check existence.
 */
export function normalizeEnvId(raw: string | undefined | null): string {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '') return SHARED_ENV;
  if (v !== SHARED_ENV && !ENV_ID_RE.test(v)) throw new UnknownEnvError(v.slice(0, 64));
  return v;
}

/**
 * Resolves an env id to its instance config. `shared` never touches the
 * registry secret. Unknown id → `UnknownEnvError` (400).
 */
export async function resolveInstance(envId: string): Promise<GsInstance> {
  if (envId === SHARED_ENV) {
    const cfg = getConfig();
    const apiBaseUrl = await getSecretOrEnv(cfg.GS_OAUTH_BASE_URL, cfg.SECRET_GS_OAUTH_BASE_URL);
    return { envId: SHARED_ENV, apiBaseUrl };
  }
  const registry = await loadRegistry();
  const instance = registry.get(envId);
  if (!instance) throw new UnknownEnvError(envId);
  return instance;
}
