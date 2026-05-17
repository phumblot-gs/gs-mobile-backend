/**
 * Local dev entry point: runs the Hono app on a plain Node HTTP server so
 * `pnpm dev` lets you hit endpoints from a phone simulator or curl without
 * needing API Gateway / Lambda Local.
 *
 * NOTE: This bypasses the AWS Lambda adapter — handlers still need to be able
 * to talk to AWS (DynamoDB, S3, Secrets Manager). Use either real AWS creds via
 * `AWS_PROFILE=...` or supply inline overrides via env vars (see env.development.example).
 */
import { serve } from '@hono/node-server';
import { app } from './index.js';

const port = Number(process.env.PORT ?? 3000);

serve(
  {
    fetch: app.fetch,
    port
  },
  (info) => {
    // eslint-disable-next-line no-console
    console.warn(`[gs-mobile-backend] listening on http://localhost:${info.port}`);
  }
);
