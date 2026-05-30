import type { Context } from 'hono';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  OAuthTokenResponseZ,
  UnauthorizedError,
  UpstreamError
} from '@gs-mobile-backend/core';
import { getConfig, getMobileDeepLink, getOAuthRedirectUri } from '../lib/config.js';
import { consumeOAuthState, putOAuthSession } from '../lib/dynamo.js';
import { getSecretOrEnv } from '../lib/secrets.js';
import { fetchMe, redactEmail } from '../lib/gs-me.js';

const CallbackQueryZ = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  error: z.string().optional(),
  error_description: z.string().optional()
});

/**
 * GET /auth/callback?code=...&state=...
 *
 * Receives the redirect from Grand Shooting. Validates state, exchanges the
 * authorization code for tokens (server-to-server with client_secret), stores
 * the tokens behind a one-shot session id, and bounces the user back into the
 * iOS app via the `gsmobile://auth/done?session_id=...` deep link.
 */
export async function authCallback(c: Context): Promise<Response> {
  const cfg = getConfig();
  const parsed = CallbackQueryZ.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) {
    throw new UnauthorizedError('Invalid OAuth callback parameters', parsed.error.flatten());
  }
  const { code, state, error, error_description } = parsed.data;
  if (error) {
    throw new UpstreamError(`OAuth provider error: ${error}`, { error_description });
  }

  const stateRecord = await consumeOAuthState(state);
  if (!stateRecord) {
    throw new UnauthorizedError('Unknown or expired OAuth state');
  }

  const [clientId, clientSecret, baseUrl] = await Promise.all([
    getSecretOrEnv(cfg.GS_OAUTH_CLIENT_ID, cfg.SECRET_GS_OAUTH_CLIENT_ID),
    getSecretOrEnv(cfg.GS_OAUTH_CLIENT_SECRET, cfg.SECRET_GS_OAUTH_CLIENT_SECRET),
    getSecretOrEnv(cfg.GS_OAUTH_BASE_URL, cfg.SECRET_GS_OAUTH_BASE_URL)
  ]);

  const tokenEndpoint = new URL('/oauth/default/token', baseUrl).toString();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: getOAuthRedirectUri(cfg),
    client_id: clientId,
    client_secret: clientSecret
  });

  const tokenRes = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json'
    },
    body
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => '<unreadable>');
    throw new UpstreamError(`Token exchange failed (${tokenRes.status})`, { upstream: text.slice(0, 500) });
  }

  const tokenJson = await tokenRes.json();
  const tokens = OAuthTokenResponseZ.parse(tokenJson);

  const sessionId = randomBytes(32).toString('hex');
  // TODO: Once GS returns per-tenant shard info inside the access token (JWT
  // claim or /me endpoint), look it up here. For now derive from env.
  const apiBaseUrl = baseUrl;

  const identity = await fetchMe(tokens.access_token, baseUrl);
  const platform = stateRecord.platform;
  console.log('[auth-callback] session created', {
    session_id_prefix: sessionId.slice(0, 8),
    platform: platform ?? 'unknown',
    email: redactEmail(identity.email),
    account_id: identity.account_id,
    user_uid: identity.user_uid
  });

  await putOAuthSession({
    session_id: sessionId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expires_in,
    api_base_url: apiBaseUrl,
    email: identity.email,
    account_id: identity.account_id,
    user_uid: identity.user_uid,
    user_name: identity.user_name,
    accounts: identity.accounts,
    platform
  });

  return c.redirect(getMobileDeepLink(sessionId, cfg), 302);
}
