import type { MiddlewareHandler } from 'hono';
import { createHash } from 'node:crypto';
import {
  UnauthorizedError,
  UpstreamError,
  type GSAccount
} from '@gs-mobile-backend/core';
import { fetchMeStrict, meToIdentity } from '../lib/gs-me.js';
import { getConfig } from '../lib/config.js';
import { getSecretOrEnv } from '../lib/secrets.js';

export interface ResolvedIdentity {
  mainAccountId: number;
  userUid: number;
  userName: string;
  email?: string;
  accounts: GSAccount[];
}

// Module-level cache shared by warm-instance invocations. Keyed by SHA-256
// of the bearer token (so we never log/store the raw token in memory).
interface CacheEntry { identity: ResolvedIdentity; expiresAt: number }
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

// Exposed for tests; not meant to be called from runtime code.
export function _resetIdentityCache(): void {
  cache.clear();
}

function tokenKey(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function parseAuthHeader(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  // GS accepts both `Bearer <token>` and `access_token <token>`. We accept
  // both — the access_token variant matches the GS API convention used
  // elsewhere in the mobile clients.
  const m = /^(Bearer|access_token)\s+(.+)$/i.exec(trimmed);
  if (!m) return null;
  const token = m[2];
  return token ? token.trim() : null;
}

/**
 * Hono middleware that resolves the caller's identity from GS /me and posts
 * it on the context under `c.var.identity`. Apply on every settings route.
 *
 * - 401 if `Authorization` header is missing/malformed.
 * - 401 if GS /me rejects the token.
 * - 502 if GS /me is down or returns a malformed body.
 * - The resolved identity must have an `account_id`, `user_uid` and a
 *   non-empty `accounts[]`. Otherwise we 502 — without these we can't run
 *   the auth checks downstream.
 */
export const identityMiddleware: MiddlewareHandler = async (c, next) => {
  const token = parseAuthHeader(c.req.header('authorization'));
  if (!token) {
    throw new UnauthorizedError('Missing or malformed Authorization header');
  }

  const key = tokenKey(token);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    c.set('identity', cached.identity);
    await next();
    return;
  }

  const cfg = getConfig();
  const baseUrl = await getSecretOrEnv(cfg.GS_OAUTH_BASE_URL, cfg.SECRET_GS_OAUTH_BASE_URL);

  let me;
  try {
    me = await fetchMeStrict(token, baseUrl);
  } catch (err) {
    const e = err as { kind?: string; status?: number; body?: string; message?: string };
    if (e.kind === 'unauthorized') {
      throw new UnauthorizedError('Token rejected by /me');
    }
    throw new UpstreamError('Failed to resolve identity', {
      kind: e.kind,
      status: e.status,
      message: e.message
    });
  }

  const ident = meToIdentity(me);
  if (
    typeof ident.account_id !== 'number' ||
    typeof ident.user_uid !== 'number' ||
    !ident.accounts ||
    ident.accounts.length === 0
  ) {
    throw new UpstreamError('Incomplete identity payload from /me');
  }

  const resolved: ResolvedIdentity = {
    mainAccountId: ident.account_id,
    userUid: ident.user_uid,
    userName: ident.user_name ?? '',
    email: ident.email,
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
