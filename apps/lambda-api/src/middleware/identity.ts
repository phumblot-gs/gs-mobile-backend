import type { MiddlewareHandler } from 'hono';
import { createHash } from 'node:crypto';
import {
  UnauthorizedError,
  UpstreamError,
  type GSAccount
} from '@gs-mobile-backend/core';
import { fetchMeStrict, meToIdentity, type AuthScheme } from '../lib/gs-me.js';
import { normalizeEnvId, resolveInstance } from '../lib/gs-instances.js';

export interface ResolvedIdentity {
  /**
   * GS instance the identity belongs to (`X-GS-Env`, default `shared`).
   * account ids are only unique within an instance: every storage key and
   * rate-limit bucket must be partitioned by this value.
   */
  env: string;
  mainAccountId: number;
  mainAccountName?: string;
  userUid: number;
  userName: string;
  email?: string;
  role?: string;
  accounts: GSAccount[];
}

// Module-level cache shared by warm-instance invocations. Keyed by SHA-256
// of (env, scheme, token) so we never log/store the raw token in memory, and
// the same token string on two instances never shares an identity.
interface CacheEntry { identity: ResolvedIdentity; expiresAt: number }
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

// Exposed for tests; not meant to be called from runtime code.
export function _resetIdentityCache(): void {
  cache.clear();
}

function cacheKey(env: string, scheme: AuthScheme, token: string): string {
  return createHash('sha256').update(`${env}\0${scheme}\0${token}`, 'utf8').digest('hex');
}

export interface ParsedAuth {
  scheme: AuthScheme;
  token: string;
}

/**
 * Parses `Authorization`. GS accepts both schemes but not interchangeably:
 * `access_token <token>` for OAuth-issued tokens, `Bearer <key>` for personal
 * API keys. We keep the scheme so `/me` is called exactly the way the client
 * authenticated. Scheme matching is case-insensitive; the result is canonical.
 */
export function parseAuthHeader(value: string | undefined | null): ParsedAuth | null {
  if (!value) return null;
  const m = /^(Bearer|access_token)\s+(.+)$/i.exec(value.trim());
  if (!m) return null;
  const token = m[2]?.trim();
  if (!token) return null;
  const scheme: AuthScheme = m[1]!.toLowerCase() === 'bearer' ? 'Bearer' : 'access_token';
  return { scheme, token };
}

/**
 * Hono middleware that resolves the caller's identity from GS /me and posts
 * it on the context under `c.var.identity`. Apply on every settings route.
 *
 * - 400 `unknown_env` if `X-GS-Env` names no registered instance
 *   (absent = `shared`, the multi-tenant instance — pre-existing behaviour).
 * - 401 if `Authorization` header is missing/malformed.
 * - 401 if GS /me rejects the token.
 * - 502 if GS /me is down or returns a malformed body.
 * - The resolved identity must have an `account_id`, `user_uid` and a
 *   non-empty `accounts[]`. Otherwise we 502 — without these we can't run
 *   the auth checks downstream.
 */
export const identityMiddleware: MiddlewareHandler = async (c, next) => {
  // Validate the env first: an unknown instance is a client config error,
  // whatever the credentials.
  const env = normalizeEnvId(c.req.header('x-gs-env'));
  const instance = await resolveInstance(env);

  const auth = parseAuthHeader(c.req.header('authorization'));
  if (!auth) {
    throw new UnauthorizedError('Missing or malformed Authorization header');
  }
  const { scheme, token } = auth;

  const key = cacheKey(env, scheme, token);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    c.set('identity', cached.identity);
    await next();
    return;
  }

  let me;
  try {
    me = await fetchMeStrict(token, instance.apiBaseUrl, scheme);
  } catch (err) {
    const e = err as { kind?: string; status?: number; body?: string; message?: string };
    if (e.kind === 'unauthorized') {
      throw new UnauthorizedError('Token rejected by /me');
    }
    console.warn('[identity] /me failed', { env, kind: e.kind, status: e.status });
    throw new UpstreamError('Failed to resolve identity', {
      kind: e.kind,
      status: e.status,
      message: e.message
    });
  }

  const ident = meToIdentity(me);
  if (
    typeof ident.account_id !== 'number' ||
    !ident.accounts ||
    ident.accounts.length === 0
  ) {
    throw new UpstreamError('Incomplete identity payload from /me');
  }

  // GS /v3/account/me doesn't currently expose user_uid. Fall back to
  // account_id so audit fields and the per-user rate-limit bucket still
  // have a stable identifier. The trade-off: rate limits become per-tenant
  // instead of per-individual-user. Acceptable until GS surfaces user_uid.
  const userUid =
    typeof ident.user_uid === 'number' ? ident.user_uid : ident.account_id;

  const resolved: ResolvedIdentity = {
    env,
    mainAccountId: ident.account_id,
    mainAccountName: ident.company,
    userUid,
    userName: ident.user_name ?? '',
    email: ident.email,
    role: me.role,
    accounts: ident.accounts
  };
  cache.set(key, { identity: resolved, expiresAt: now + CACHE_TTL_MS });

  c.set('identity', resolved);
  await next();
};

/** Helper for handlers to fetch the resolved identity without re-typing. */
export function requireIdentity(c: { var: { identity?: ResolvedIdentity } }): ResolvedIdentity {
  const id = c.var.identity;
  if (!id) {
    throw new UpstreamError('identity middleware did not run');
  }
  return id;
}
