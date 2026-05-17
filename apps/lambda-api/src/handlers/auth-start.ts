import type { Context } from 'hono';
import { randomBytes } from 'node:crypto';
import { getConfig, getOAuthRedirectUri } from '../lib/config.js';
import { putOAuthState } from '../lib/dynamo.js';
import { getSecretOrEnv } from '../lib/secrets.js';

/**
 * GET /auth/start
 *
 * Entry point for the iOS app's ASWebAuthenticationSession. Generates a CSRF
 * state token, stashes it in DynamoDB, and 302-redirects the browser to the
 * Grand Shooting authorization endpoint.
 */
export async function authStart(c: Context): Promise<Response> {
  const cfg = getConfig();

  const state = randomBytes(32).toString('hex');
  await putOAuthState(state);

  const [clientId, baseUrl] = await Promise.all([
    getSecretOrEnv(cfg.GS_OAUTH_CLIENT_ID, cfg.SECRET_GS_OAUTH_CLIENT_ID),
    getSecretOrEnv(cfg.GS_OAUTH_BASE_URL, cfg.SECRET_GS_OAUTH_BASE_URL)
  ]);

  const authorizeUrl = new URL('/oauth/default/authorize', baseUrl);
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', getOAuthRedirectUri(cfg));
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', 'read write');
  authorizeUrl.searchParams.set('state', state);

  return c.redirect(authorizeUrl.toString(), 302);
}
