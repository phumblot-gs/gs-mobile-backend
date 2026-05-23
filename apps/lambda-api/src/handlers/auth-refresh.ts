import type { Context } from 'hono';
import {
  AuthRefreshRequestZ,
  AuthRefreshResponseZ,
  OAuthTokenResponseZ,
  UnauthorizedError,
  UpstreamError
} from '@gs-mobile-backend/core';
import { getConfig } from '../lib/config.js';
import { getSecretOrEnv } from '../lib/secrets.js';
import { fetchUserEmail, redactEmail } from '../lib/gs-userinfo.js';

/**
 * POST /auth/refresh
 *
 * Refreshes an access_token using the long-lived refresh_token the mobile app
 * stored in its Keychain. The backend stays a confidential client.
 */
export async function authRefresh(c: Context): Promise<Response> {
  const cfg = getConfig();
  const body = await c.req.json().catch(() => ({}));
  const parsed = AuthRefreshRequestZ.safeParse(body);
  if (!parsed.success) {
    throw new UnauthorizedError('Invalid refresh request', parsed.error.flatten());
  }

  const [clientId, clientSecret, baseUrl] = await Promise.all([
    getSecretOrEnv(cfg.GS_OAUTH_CLIENT_ID, cfg.SECRET_GS_OAUTH_CLIENT_ID),
    getSecretOrEnv(cfg.GS_OAUTH_CLIENT_SECRET, cfg.SECRET_GS_OAUTH_CLIENT_SECRET),
    getSecretOrEnv(cfg.GS_OAUTH_BASE_URL, cfg.SECRET_GS_OAUTH_BASE_URL)
  ]);

  const res = await fetch(new URL('/oauth/default/token', baseUrl).toString(), {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: parsed.data.refresh_token,
      client_id: clientId,
      client_secret: clientSecret
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '<unreadable>');
    if (res.status === 400 || res.status === 401) {
      throw new UnauthorizedError('Refresh token rejected', { upstream: text.slice(0, 500) });
    }
    throw new UpstreamError(`Refresh failed (${res.status})`, { upstream: text.slice(0, 500) });
  }

  const tokens = OAuthTokenResponseZ.parse(await res.json());

  // Best-effort userinfo lookup so the iOS app can re-hydrate `userEmail`
  // on a cold launch where only the refresh token is in the Keychain.
  // Failure must not break the refresh.
  const email = await fetchUserEmail(tokens.access_token, baseUrl);
  if (email) {
    console.log('[auth-refresh] refreshed', { email: redactEmail(email) });
  }

  return c.json(
    AuthRefreshResponseZ.parse({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      email
    })
  );
}
