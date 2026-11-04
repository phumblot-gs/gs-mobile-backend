import type { MiddlewareHandler } from 'hono';
import { consumeRateLimit } from '../lib/rate-limit-dynamo.js';
import { requireIdentity, type ResolvedIdentity } from './identity.js';
import { SHARED_ENV } from '../lib/gs-instances.js';

/**
 * Bucket keys are partitioned by GS instance: account ids are only unique
 * within an instance. `shared` keeps the historical keys (`pull#16`), other
 * instances are prefixed (`gl#pull#16`). Exported for tests.
 */
export function bucketKey(env: string, key: string): string {
  return env === SHARED_ENV ? key : `${env}#${key}`;
}

/**
 * Pull rate limit: 30 requests / minute per user_uid (cap is global per
 * user — a user juggling tenants doesn't get 30 × N tenants).
 */
export const pullRateLimit: MiddlewareHandler = async (c, next) => {
  const identity = requireIdentity(c as unknown as { var: { identity?: ResolvedIdentity } });
  const result = await consumeRateLimit({
    bucketKey: bucketKey(identity.env, `pull#${identity.userUid}`),
    windowSeconds: 60,
    limit: 30
  });
  if (!result.allowed) {
    return rateLimitedResponse(c, result.retryAfterSeconds);
  }
  await next();
  return;
};

/**
 * Push rate limit: 1 request / 5 s per (main_account_id, active_account_id).
 * The active_account_id comes from the URL path param `active_account_id`.
 */
export const pushRateLimit: MiddlewareHandler = async (c, next) => {
  const identity = requireIdentity(c as unknown as { var: { identity?: ResolvedIdentity } });
  const activeRaw = c.req.param('active_account_id');
  const activeId = Number(activeRaw);
  if (!Number.isFinite(activeId)) {
    await next();
    return;
  }
  const result = await consumeRateLimit({
    bucketKey: bucketKey(identity.env, `push#${identity.mainAccountId}#${activeId}`),
    windowSeconds: 5,
    limit: 1
  });
  if (!result.allowed) {
    return rateLimitedResponse(c, result.retryAfterSeconds);
  }
  await next();
  return;
};

function rateLimitedResponse(c: Parameters<MiddlewareHandler>[0], retryAfterSeconds: number) {
  c.header('Retry-After', String(retryAfterSeconds));
  return c.json(
    {
      error: 'Rate limit exceeded',
      code: 'rate_limited',
      details: { retry_after_seconds: retryAfterSeconds }
    },
    429
  );
}
