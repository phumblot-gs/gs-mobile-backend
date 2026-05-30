import type { Context } from 'hono';
import { randomBytes } from 'node:crypto';
import { BadRequestError, PlatformZ, type Platform } from '@gs-mobile-backend/core';
import { getConfig, getOAuthRedirectUri } from '../lib/config.js';
import { putOAuthState } from '../lib/dynamo.js';
import { getSecretOrEnv } from '../lib/secrets.js';

/**
 * GET /auth/start
 *
 * Entry point for the mobile clients' system-browser sign-in session
 * (ASWebAuthenticationSession on iOS, Chrome Custom Tabs on Android).
 * Generates a CSRF state token, stashes it in DynamoDB along with the
 * originating platform, and 302-redirects the browser to the Grand Shooting
 * authorization endpoint.
 *
 * The `platform` query param is optional for back-compat with the iOS client
 * that didn't send it; missing value is treated as `ios`. Anything other than
 * `ios` or `android` is rejected with 400.
 */
export async function authStart(c: Context): Promise<Response> {
  const cfg = getConfig();

  const rawPlatform = c.req.query('platform');
  let platform: Platform;
  if (rawPlatform === undefined) {
    platform = 'ios';
  } else {
    const parsed = PlatformZ.safeParse(rawPlatform);
    if (!parsed.success) {
      throw new BadRequestError(`Unsupported platform: ${rawPlatform}`, {
        allowed: PlatformZ.options
      });
    }
    platform = parsed.data;
  }

  const state = randomBytes(32).toString('hex');
  await putOAuthState(state, platform);

  const [clientId, baseUrl] = await Promise.all([
    getSecretOrEnv(cfg.GS_OAUTH_CLIENT_ID, cfg.SECRET_GS_OAUTH_CLIENT_ID),
    getSecretOrEnv(cfg.GS_OAUTH_BASE_URL, cfg.SECRET_GS_OAUTH_BASE_URL)
  ]);

  console.log('[auth-start]', { platform, state_prefix: state.slice(0, 8) });

  const authorizeUrl = new URL('/oauth/default/authorize', baseUrl);
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', getOAuthRedirectUri(cfg));
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', 'read write');
  authorizeUrl.searchParams.set('state', state);

  return c.redirect(authorizeUrl.toString(), 302);
}
