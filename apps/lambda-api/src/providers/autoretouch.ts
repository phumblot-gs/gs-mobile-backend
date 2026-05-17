import { UpstreamError } from '@gs-mobile-backend/core';
import { getConfig } from '../lib/config.js';
import { getSecretOrEnv } from '../lib/secrets.js';
import type { PackshotProvider } from './types.js';

/**
 * Autoretouch workflow-based provider.
 *
 * Docs: https://docs.autoretouch.com/api/
 *
 * High-level flow (TODO: confirm exact wire format with API docs, the names
 * below match the public REST endpoints we've used historically):
 *   1. POST /v1/image  multipart/form-data { file } -> { imageUploadId }
 *   2. POST /v1/workflow/execution/create
 *        { workflow: <workflowId>, inputImages: [{ imageUploadId }] }
 *      -> { id: <executionId> }
 *   3. GET  /v1/workflow/execution/{executionId}  -> { status, resultUrl, ... }
 *      Poll until status === 'COMPLETED' (or 'FAILED').
 *   4. GET  <resultUrl>  -> processed image bytes
 *
 * Concurrency note: each execution can take ~10s. Lambda timeout is 30s, so we
 * cap the polling window at 25s and fail loudly otherwise. For longer-running
 * workflows we should switch to a webhook callback (TODO).
 */
export class AutoretouchProvider implements PackshotProvider {
  readonly name = 'autoretouch';
  private readonly baseUrl = 'https://api.autoretouch.com';
  private readonly maxPollMs = 25_000;
  private readonly pollIntervalMs = 1_000;

  async process(
    input: { buffer: Buffer; mimeType: string },
    opts: { workflowId?: string }
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const cfg = getConfig();
    const apiKey = await getSecretOrEnv(cfg.AUTORETOUCH_API_KEY, cfg.SECRET_AUTORETOUCH_API_KEY);
    if (!opts.workflowId) {
      throw new UpstreamError('Autoretouch requires workflow_id');
    }
    const auth = `Bearer ${apiKey}`;

    // --- 1. Upload image -----------------------------------------------------
    const uploadForm = new FormData();
    uploadForm.append('file', new Blob([input.buffer], { type: input.mimeType }), 'input');

    const uploadRes = await fetch(`${this.baseUrl}/v1/image`, {
      method: 'POST',
      headers: { authorization: auth },
      body: uploadForm
    });
    if (!uploadRes.ok) {
      throw new UpstreamError(`Autoretouch upload failed (${uploadRes.status})`, {
        upstream: await uploadRes.text().catch(() => '<unreadable>')
      });
    }
    // TODO: confirm response shape — earlier API revisions returned a bare string id.
    const uploadJson = (await uploadRes.json()) as { imageUploadId?: string; id?: string };
    const imageUploadId = uploadJson.imageUploadId ?? uploadJson.id;
    if (!imageUploadId) throw new UpstreamError('Autoretouch returned no imageUploadId');

    // --- 2. Create execution -------------------------------------------------
    const createRes = await fetch(`${this.baseUrl}/v1/workflow/execution/create`, {
      method: 'POST',
      headers: { authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        workflow: opts.workflowId,
        inputImages: [{ imageUploadId }]
      })
    });
    if (!createRes.ok) {
      throw new UpstreamError(`Autoretouch create execution failed (${createRes.status})`, {
        upstream: await createRes.text().catch(() => '<unreadable>')
      });
    }
    const createJson = (await createRes.json()) as { id?: string };
    const executionId = createJson.id;
    if (!executionId) throw new UpstreamError('Autoretouch returned no execution id');

    // --- 3. Poll for completion ---------------------------------------------
    const started = Date.now();
    let resultUrl: string | undefined;
    while (Date.now() - started < this.maxPollMs) {
      const pollRes = await fetch(`${this.baseUrl}/v1/workflow/execution/${executionId}`, {
        headers: { authorization: auth }
      });
      if (!pollRes.ok) {
        throw new UpstreamError(`Autoretouch poll failed (${pollRes.status})`);
      }
      const pollJson = (await pollRes.json()) as { status?: string; resultUrl?: string };
      if (pollJson.status === 'COMPLETED' && pollJson.resultUrl) {
        resultUrl = pollJson.resultUrl;
        break;
      }
      if (pollJson.status === 'FAILED') {
        throw new UpstreamError('Autoretouch workflow failed');
      }
      await sleep(this.pollIntervalMs);
    }
    if (!resultUrl) {
      throw new UpstreamError('Autoretouch workflow timed out');
    }

    // --- 4. Download result --------------------------------------------------
    const downloadRes = await fetch(resultUrl);
    if (!downloadRes.ok) {
      throw new UpstreamError(`Autoretouch download failed (${downloadRes.status})`);
    }
    const contentType = downloadRes.headers.get('content-type') ?? 'image/png';
    const buffer = Buffer.from(await downloadRes.arrayBuffer());
    return { buffer, mimeType: contentType };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
