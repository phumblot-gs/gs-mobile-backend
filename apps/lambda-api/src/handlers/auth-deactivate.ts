import type { Context } from 'hono';

/**
 * Plugin deactivation webhook called by Grand Shooting when a user revokes
 * the plugin (from their GS account settings, or because the OAuth grant
 * expired without refresh). The plugin is expected to clean up any data
 * stored for that user and acknowledge with 200.
 *
 * Current implementation is a no-op placeholder: we don't persist OAuth
 * tokens per user yet (they live in the iOS Keychain on each device, not
 * server-side), so there's nothing to delete. We log the call so we can
 * confirm GS is hitting us correctly and inspect the payload to refine the
 * contract once we observe real traffic.
 *
 * Accepts both GET and POST to be defensive about GS's exact convention,
 * which isn't documented in the plugin admin form.
 */
export async function authDeactivate(c: Context): Promise<Response> {
  const method = c.req.method;
  let body: unknown = undefined;
  if (method === 'POST') {
    body = await c.req.json().catch(() => undefined);
  }
  const query = Object.fromEntries(new URL(c.req.url).searchParams);

  // eslint-disable-next-line no-console
  console.log('[auth-deactivate]', {
    method,
    ip: c.req.header('x-forwarded-for'),
    userAgent: c.req.header('user-agent'),
    query,
    body
  });

  // TODO once the payload contract is observed:
  //   - validate signature / shared secret if GS includes one
  //   - identify the user (likely by `account_id` or similar)
  //   - delete any server-side per-user state (DynamoDB row, S3 prefix, ...)

  return c.json({ status: 'ok', acknowledged: true }, 200);
}
