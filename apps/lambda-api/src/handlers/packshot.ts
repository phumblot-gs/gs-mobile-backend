import type { Context } from 'hono';
import { createHash } from 'node:crypto';
import {
  BadRequestError,
  PackshotRequestZ,
  PackshotResponseZ
} from '@gs-mobile-backend/core';
import { downloadUpload, uploadPackshot } from '../lib/s3.js';
import { PhotoroomProvider } from '../providers/photoroom.js';
import { AutoretouchProvider } from '../providers/autoretouch.js';
import type { PackshotProvider } from '../providers/types.js';

/**
 * POST /packshot
 *
 * Pulls the source image from S3 (uploaded via /upload/init), dispatches it to
 * the chosen provider, stores the result back in the packshots bucket, and
 * returns a short-lived presigned URL for the iOS app to fetch the result.
 */
export async function packshot(c: Context): Promise<Response> {
  const start = Date.now();
  const raw = await c.req.json().catch(() => ({}));
  const parsed = PackshotRequestZ.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestError('Invalid packshot request', parsed.error.flatten());
  }

  const { upload_key, provider, workflow_id } = parsed.data;

  const source = await downloadUpload(upload_key);
  const impl = pickProvider(provider);

  const processed = await impl.process(
    { buffer: source.buffer, mimeType: source.contentType },
    { workflowId: workflow_id }
  );

  const hash = createHash('sha256').update(processed.buffer).digest('hex').slice(0, 24);
  const ext = mimeToExt(processed.mimeType);
  const key = `${new Date().toISOString().slice(0, 10)}/${hash}.${ext}`;

  const result_url = await uploadPackshot(key, processed.buffer, processed.mimeType);

  return c.json(
    PackshotResponseZ.parse({
      result_url,
      provider: impl.name as 'photoroom' | 'autoretouch',
      took_ms: Date.now() - start
    })
  );
}

function pickProvider(name: 'photoroom' | 'autoretouch'): PackshotProvider {
  switch (name) {
    case 'photoroom':
      return new PhotoroomProvider();
    case 'autoretouch':
      return new AutoretouchProvider();
    default: {
      const _exhaustive: never = name;
      throw new BadRequestError(`Unknown provider: ${String(_exhaustive)}`);
    }
  }
}

function mimeToExt(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  return 'bin';
}
