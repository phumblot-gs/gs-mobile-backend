import type { Context } from 'hono';
import {
  AuthExchangeRequestZ,
  AuthExchangeResponseZ,
  UnauthorizedError
} from '@gs-mobile-backend/core';
import { consumeOAuthSession } from '../lib/dynamo.js';

/**
 * POST /auth/exchange
 *
 * The iOS app — having received the `session_id` via deep link — calls this
 * endpoint exactly once to swap it for the actual OAuth tokens.
 */
export async function authExchange(c: Context): Promise<Response> {
  const body = await c.req.json().catch(() => ({}));
  const parsed = AuthExchangeRequestZ.safeParse(body);
  if (!parsed.success) {
    throw new UnauthorizedError('Invalid exchange request', parsed.error.flatten());
  }

  const session = await consumeOAuthSession(parsed.data.session_id);
  if (!session) {
    throw new UnauthorizedError('Unknown or expired session');
  }

  const payload = AuthExchangeResponseZ.parse({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    api_base_url: session.api_base_url,
    email: session.email,
    account_id: session.account_id,
    user_uid: session.user_uid,
    user_name: session.user_name,
    accounts: session.accounts
  });

  return c.json(payload);
}
