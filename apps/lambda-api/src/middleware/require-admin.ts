import type { MiddlewareHandler } from 'hono';
import { requireIdentity, type ResolvedIdentity } from './identity.js';

/**
 * Reject any settings request whose caller is not a GS admin.
 *
 * ⚠️ CURRENTLY UNUSED — not wired up in `index.ts`. GS `GET /v3/account/me`
 * does not expose a `role` field (verified live 2026-06-16), so `identity.role`
 * is always undefined and this gate 403'd every caller, admins included. Kept
 * for easy re-enable once GS surfaces a role on /me. See docs/SETTINGS-SYNC.md.
 *
 * Must run AFTER `identityMiddleware` so `c.var.identity` is populated.
 *
 * Response: 403 with a stable `code: "not_admin"` so clients can branch
 * on it (e.g. greyed-out push button in the Settings UI).
 */
export const requireAdmin: MiddlewareHandler = async (c, next) => {
  const identity = requireIdentity(c as unknown as { var: { identity?: ResolvedIdentity } });
  if (identity.role !== 'admin') {
    return c.json(
      {
        error: 'Admin role required',
        code: 'not_admin',
        details: { role: identity.role ?? null }
      },
      403
    );
  }
  await next();
  return;
};
