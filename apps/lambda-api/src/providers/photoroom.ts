import { UpstreamError } from '@gs-mobile-backend/core';
import { getConfig } from '../lib/config.js';
import { getSecretOrEnv } from '../lib/secrets.js';
import type { PackshotProvider } from './types.js';

/**
 * Photoroom segment / packshot API.
 *
 * Docs: https://www.photoroom.com/api
 * Endpoint: POST https://sdk.photoroom.com/v1/segment
 *           multipart/form-data, field `image_file`
 *           header `x-api-key: <api key>`
 *
 * Returns a PNG with a transparent background.
 */
export class PhotoroomProvider implements PackshotProvider {
  readonly name = 'photoroom';

  async process(input: { buffer: Buffer; mimeType: string }): Promise<{ buffer: Buffer; mimeType: string }> {
    const cfg = getConfig();
    const apiKey = await getSecretOrEnv(cfg.PHOTOROOM_API_KEY, cfg.SECRET_PHOTOROOM_API_KEY);

    const form = new FormData();
    form.append('image_file', new Blob([input.buffer], { type: input.mimeType }), 'input');

    const res = await fetch('https://sdk.photoroom.com/v1/segment', {
      method: 'POST',
      headers: {
        accept: 'image/png, application/json',
        'x-api-key': apiKey
      },
      body: form
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '<unreadable>');
      throw new UpstreamError(`Photoroom failed (${res.status})`, { upstream: text.slice(0, 500) });
    }

    const contentType = res.headers.get('content-type') ?? 'image/png';
    const out = Buffer.from(await res.arrayBuffer());
    return { buffer: out, mimeType: contentType };
  }
}
