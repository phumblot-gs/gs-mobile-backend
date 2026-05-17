import type { Context } from 'hono';
import {
  BadRequestError,
  UploadInitRequestZ,
  UploadInitResponseZ
} from '@gs-mobile-backend/core';
import { presignUpload } from '../lib/s3.js';

/**
 * POST /upload/init
 *
 * Returns a short-lived pre-signed PUT URL the iOS app uses to upload the
 * source image straight to S3 — keeping image bytes out of the Lambda hot path.
 */
export async function uploadInit(c: Context): Promise<Response> {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = UploadInitRequestZ.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestError('Invalid upload request', parsed.error.flatten());
  }
  const presigned = await presignUpload(parsed.data.content_type, parsed.data.filename);
  return c.json(UploadInitResponseZ.parse(presigned));
}
