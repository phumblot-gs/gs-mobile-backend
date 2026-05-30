import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { handle } from 'hono/aws-lambda';
import { AppError, InternalError } from '@gs-mobile-backend/core';
import { authStart } from './handlers/auth-start.js';
import { authCallback } from './handlers/auth-callback.js';
import { authExchange } from './handlers/auth-exchange.js';
import { authRefresh } from './handlers/auth-refresh.js';
import { authDeactivate } from './handlers/auth-deactivate.js';
import { uploadInit } from './handlers/upload-init.js';
import { packshot } from './handlers/packshot.js';
import {
  listAllSettings,
  getSettings,
  postSettings,
  listHistory,
  getHistoryVersion,
  restoreHistoryVersion,
  deleteHistoryVersion
} from './handlers/settings/index.js';
import { identityMiddleware } from './middleware/identity.js';
import { requireAdmin } from './middleware/require-admin.js';
import { pullRateLimit, pushRateLimit } from './middleware/rate-limit.js';

export const app = new Hono();

// =============================================================================
// Global middleware
// =============================================================================

// iOS doesn't enforce CORS for native HTTP requests, but the OAuth flow runs
// inside a WebView so we still need permissive CORS for the auth endpoints,
// and we use localhost during local dev. TODO: tighten origins post-launch.
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['content-type', 'authorization'],
  maxAge: 86400
}));

app.use('*', logger());

// =============================================================================
// Health
// =============================================================================
app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'gs-mobile-backend',
    timestamp: new Date().toISOString(),
    environment: process.env.ENVIRONMENT ?? 'unknown'
  })
);

// =============================================================================
// Auth (OAuth proxy)
// =============================================================================
app.get('/auth/start', authStart);
app.get('/auth/callback', authCallback);
app.post('/auth/exchange', authExchange);
app.post('/auth/refresh', authRefresh);
app.get('/auth/deactivate', authDeactivate);
app.post('/auth/deactivate', authDeactivate);

// =============================================================================
// Uploads + packshot
// =============================================================================
app.post('/upload/init', uploadInit);
app.post('/packshot', packshot);

// =============================================================================
// Account settings sync — identity middleware on all routes, plus per-verb
// rate limiting.
// =============================================================================
app.use('/account/settings/*', identityMiddleware);
app.use('/account/settings/*', requireAdmin);
app.use('/account/settings', identityMiddleware);
app.use('/account/settings', requireAdmin);

app.get('/account/settings', pullRateLimit, listAllSettings);
app.get('/account/settings/:active_account_id', pullRateLimit, getSettings);
app.post('/account/settings/:active_account_id', pushRateLimit, postSettings);
app.get('/account/settings/:active_account_id/history', pullRateLimit, listHistory);
app.get('/account/settings/:active_account_id/history/:version_id', pullRateLimit, getHistoryVersion);
app.post('/account/settings/:active_account_id/history/:version_id/restore', pushRateLimit, restoreHistoryVersion);
app.delete('/account/settings/:active_account_id/history/:version_id', pushRateLimit, deleteHistoryVersion);

// =============================================================================
// Error handling
// =============================================================================
app.onError((err, c) => {
  // eslint-disable-next-line no-console
  console.error('[handler-error]', {
    path: c.req.path,
    method: c.req.method,
    error: err.message,
    name: err.name,
    stack: process.env.ENVIRONMENT === 'production' ? undefined : err.stack
  });

  if (err instanceof AppError) {
    return c.json(err.toJSON(), err.status as 400 | 401 | 404 | 409 | 500 | 502);
  }
  const wrapped = new InternalError(
    process.env.ENVIRONMENT === 'production' ? 'Internal server error' : err.message
  );
  return c.json(wrapped.toJSON(), 500);
});

app.notFound((c) => c.json({ error: 'Not found', code: 'not_found' }, 404));

// =============================================================================
// Lambda export
// =============================================================================
export const handler = handle(app);
