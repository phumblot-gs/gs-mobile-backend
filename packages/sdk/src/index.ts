/**
 * Placeholder client SDK for the Grand Shooting mobile backend.
 *
 * The iOS app does not consume this — it speaks raw HTTP — but a future web/admin
 * client may. We re-export shared types from @gs-mobile-backend/core for now.
 */

export * from '@gs-mobile-backend/core';

export interface MobileBackendClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}

export class MobileBackendClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(opts: MobileBackendClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
  }

  /** TODO: implement once API stabilises */
  async health(): Promise<{ status: string }> {
    const res = await this.fetchImpl(`${this.baseUrl}/health`);
    if (!res.ok) throw new Error(`health check failed: ${res.status}`);
    return (await res.json()) as { status: string };
  }
}
