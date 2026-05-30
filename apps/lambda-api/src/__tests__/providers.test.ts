import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/secrets.js', () => ({
  getSecret: vi.fn(async () => 'secret-value'),
  getSecretOrEnv: vi.fn(async (inline: string | undefined) => inline ?? 'secret-value'),
  _resetSecretsCache: vi.fn()
}));

beforeEach(() => {
  process.env.ENVIRONMENT = 'development';
  process.env.AWS_REGION = 'eu-west-1';
  process.env.DYNAMO_OAUTH_STATE_TABLE = 'state-test';
  process.env.DYNAMO_OAUTH_SESSIONS_TABLE = 'sessions-test';
  process.env.DYNAMO_ACCOUNT_SETTINGS_POINTER_TABLE = 'ptr-test';
  process.env.DYNAMO_ACCOUNT_SETTINGS_VERSION_TABLE = 'ver-test';
  process.env.DYNAMO_ACCOUNT_SETTINGS_RATE_LIMIT_TABLE = 'rl-test';
  process.env.S3_UPLOADS_BUCKET = 'uploads-test';
  process.env.S3_PACKSHOTS_BUCKET = 'packshots-test';
  process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
  process.env.MOBILE_DEEP_LINK_SCHEME = 'gsmobile';
  process.env.SECRET_GS_OAUTH_CLIENT_ID = 'gs-mobile/dev/cid';
  process.env.SECRET_GS_OAUTH_CLIENT_SECRET = 'gs-mobile/dev/csec';
  process.env.SECRET_GS_OAUTH_BASE_URL = 'gs-mobile/dev/burl';
  process.env.SECRET_PHOTOROOM_API_KEY = 'gs-mobile/dev/pr';
  process.env.SECRET_AUTORETOUCH_API_KEY = 'gs-mobile/dev/ar';
  process.env.PHOTOROOM_API_KEY = 'pr-test';
  process.env.AUTORETOUCH_API_KEY = 'ar-test';
});

describe('PhotoroomProvider', () => {
  it('POSTs to /v1/segment with x-api-key and returns the image bytes', async () => {
    const { resetConfigCache } = await import('../lib/config.js');
    resetConfigCache();
    const { PhotoroomProvider } = await import('../providers/photoroom.js');

    const outBuffer = Buffer.from([1, 2, 3, 4]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(outBuffer, { status: 200, headers: { 'content-type': 'image/png' } })
    );

    const provider = new PhotoroomProvider();
    const result = await provider.process(
      { buffer: Buffer.from('input'), mimeType: 'image/jpeg' },
      {}
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    const call = fetchSpy.mock.calls[0]!;
    expect(call[0]).toBe('https://sdk.photoroom.com/v1/segment');
    const init = call[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('pr-test');
    expect(result.mimeType).toBe('image/png');
    expect(result.buffer.equals(outBuffer)).toBe(true);
  });

  it('throws UpstreamError when Photoroom returns 4xx', async () => {
    const { resetConfigCache } = await import('../lib/config.js');
    resetConfigCache();
    const { PhotoroomProvider } = await import('../providers/photoroom.js');

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('bad request', { status: 400 })
    );

    const provider = new PhotoroomProvider();
    await expect(
      provider.process({ buffer: Buffer.from('x'), mimeType: 'image/png' }, {})
    ).rejects.toMatchObject({ status: 502, code: 'upstream_error' });
  });
});

describe('AutoretouchProvider', () => {
  it('requires workflow_id', async () => {
    const { resetConfigCache } = await import('../lib/config.js');
    resetConfigCache();
    const { AutoretouchProvider } = await import('../providers/autoretouch.js');

    const provider = new AutoretouchProvider();
    await expect(
      provider.process({ buffer: Buffer.from('x'), mimeType: 'image/jpeg' }, {})
    ).rejects.toMatchObject({ status: 502, code: 'upstream_error' });
  });
});
