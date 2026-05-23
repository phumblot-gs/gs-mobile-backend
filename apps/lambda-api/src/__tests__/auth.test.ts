import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Stub AWS + secrets BEFORE importing the app.
vi.mock('../lib/dynamo.js', () => {
  const states = new Map<string, { state: string; expires_at: number; created_at: number }>();
  const sessions = new Map<string, {
    session_id: string;
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    api_base_url: string;
    email?: string;
    expires_at: number;
    created_at: number;
  }>();
  return {
    putOAuthState: vi.fn(async (state: string) => {
      states.set(state, { state, expires_at: Date.now() / 1000 + 300, created_at: Date.now() / 1000 });
    }),
    consumeOAuthState: vi.fn(async (state: string) => {
      const v = states.get(state);
      if (!v) return null;
      states.delete(state);
      return v;
    }),
    putOAuthSession: vi.fn(async (rec: { session_id: string; access_token: string; refresh_token?: string; expires_in: number; api_base_url: string; email?: string }) => {
      const full = { ...rec, expires_at: Date.now() / 1000 + 60, created_at: Date.now() / 1000 };
      sessions.set(rec.session_id, full);
      return full;
    }),
    consumeOAuthSession: vi.fn(async (id: string) => {
      const v = sessions.get(id);
      if (!v) return null;
      sessions.delete(id);
      return v;
    }),
    _resetDynamoClient: vi.fn(),
    __states: states,
    __sessions: sessions
  };
});

vi.mock('../lib/secrets.js', () => ({
  getSecret: vi.fn(async () => 'secret-value'),
  getSecretOrEnv: vi.fn(async (inline: string | undefined, _id: string) => inline ?? 'secret-value'),
  _resetSecretsCache: vi.fn()
}));

const baseEnv = {
  ENVIRONMENT: 'development',
  AWS_REGION: 'eu-west-1',
  DYNAMO_OAUTH_STATE_TABLE: 'state-test',
  DYNAMO_OAUTH_SESSIONS_TABLE: 'sessions-test',
  S3_UPLOADS_BUCKET: 'uploads-test',
  S3_PACKSHOTS_BUCKET: 'packshots-test',
  PUBLIC_BASE_URL: 'http://localhost:3000',
  MOBILE_DEEP_LINK_SCHEME: 'gsmobile',
  SECRET_GS_OAUTH_CLIENT_ID: 'gs-mobile/dev/cid',
  SECRET_GS_OAUTH_CLIENT_SECRET: 'gs-mobile/dev/csec',
  SECRET_GS_OAUTH_BASE_URL: 'gs-mobile/dev/burl',
  SECRET_PHOTOROOM_API_KEY: 'gs-mobile/dev/pr',
  SECRET_AUTORETOUCH_API_KEY: 'gs-mobile/dev/ar',
  GS_OAUTH_CLIENT_ID: 'test-client-id',
  GS_OAUTH_CLIENT_SECRET: 'test-client-secret',
  GS_OAUTH_BASE_URL: 'https://api.grand-shooting.com'
};

beforeEach(() => {
  for (const [k, v] of Object.entries(baseEnv)) process.env[k] = v;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('auth handlers', () => {
  it('GET /auth/start generates a state and redirects to GS', async () => {
    const { resetConfigCache } = await import('../lib/config.js');
    resetConfigCache();
    const { app } = await import('../index.js');

    const res = await app.request('/auth/start');
    expect(res.status).toBe(302);
    const loc = res.headers.get('location');
    expect(loc).toBeTruthy();
    const u = new URL(loc!);
    expect(u.origin).toBe('https://api.grand-shooting.com');
    expect(u.pathname).toBe('/oauth/default/authorize');
    expect(u.searchParams.get('client_id')).toBe('test-client-id');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:3000/auth/callback');
    expect(u.searchParams.get('state')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('POST /auth/exchange returns 401 for an unknown session', async () => {
    const { resetConfigCache } = await import('../lib/config.js');
    resetConfigCache();
    const { app } = await import('../index.js');

    const res = await app.request('/auth/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: 'a'.repeat(64) })
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('unauthorized');
  });

  it('GET /auth/callback rejects an unknown state', async () => {
    const { resetConfigCache } = await import('../lib/config.js');
    resetConfigCache();
    const { app } = await import('../index.js');

    const res = await app.request('/auth/callback?code=abc&state=never-issued');
    expect(res.status).toBe(401);
  });

  it('GET /auth/callback completes the dance with a stubbed token endpoint', async () => {
    const { resetConfigCache } = await import('../lib/config.js');
    resetConfigCache();
    const dynamo = await import('../lib/dynamo.js');
    const { app } = await import('../index.js');

    // pre-seed a state as if /auth/start had been called
    const knownState = 'b'.repeat(64);
    await dynamo.putOAuthState(knownState);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request | URL).toString();
      if (url.includes('/oauth/default/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'tok-access',
            refresh_token: 'tok-refresh',
            token_type: 'bearer',
            expires_in: 3600
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (url.includes('/oauth/default/userinfo')) {
        return new Response(
          JSON.stringify({ sub: 'user-123', email: 'staff@grand-shooting.com' }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response('not stubbed', { status: 500 });
    });

    const res = await app.request(`/auth/callback?code=THECODE&state=${knownState}`);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc.startsWith('gsmobile://auth/done?session_id=')).toBe(true);

    const sessionId = new URL(loc).searchParams.get('session_id')!;

    // Now exchange it
    const ex = await app.request('/auth/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId })
    });
    expect(ex.status).toBe(200);
    const json = (await ex.json()) as { access_token: string; refresh_token: string; api_base_url: string; email?: string };
    expect(json.access_token).toBe('tok-access');
    expect(json.refresh_token).toBe('tok-refresh');
    expect(json.api_base_url).toBe('https://api.grand-shooting.com');
    expect(json.email).toBe('staff@grand-shooting.com');

    // exchange is one-shot — a second call must fail
    const ex2 = await app.request('/auth/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId })
    });
    expect(ex2.status).toBe(401);
  });

  it('GET /auth/callback still succeeds when userinfo lookup fails', async () => {
    const { resetConfigCache } = await import('../lib/config.js');
    resetConfigCache();
    const dynamo = await import('../lib/dynamo.js');
    const { app } = await import('../index.js');

    const knownState = 'c'.repeat(64);
    await dynamo.putOAuthState(knownState);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request | URL).toString();
      if (url.includes('/oauth/default/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'tok-access-2',
            refresh_token: 'tok-refresh-2',
            token_type: 'bearer',
            expires_in: 3600
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      // Simulate a userinfo endpoint that doesn't exist on this GS deployment.
      return new Response('not found', { status: 404 });
    });

    const res = await app.request(`/auth/callback?code=THECODE&state=${knownState}`);
    expect(res.status).toBe(302);
    const sessionId = new URL(res.headers.get('location')!).searchParams.get('session_id')!;

    const ex = await app.request('/auth/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId })
    });
    expect(ex.status).toBe(200);
    const json = (await ex.json()) as { access_token: string; email?: string };
    expect(json.access_token).toBe('tok-access-2');
    expect(json.email).toBeUndefined();
  });

  it('POST /auth/refresh proxies refresh_token to GS and includes email', async () => {
    const { resetConfigCache } = await import('../lib/config.js');
    resetConfigCache();
    const { app } = await import('../index.js');

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request | URL).toString();
      if (url.includes('/oauth/default/token')) {
        return new Response(
          JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (url.includes('/oauth/default/userinfo')) {
        return new Response(
          JSON.stringify({ sub: 'user-123', email: 'someone@example.com' }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response('not stubbed', { status: 500 });
    });

    const res = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: 'old-refresh' })
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { access_token: string; email?: string };
    expect(json.access_token).toBe('new-access');
    expect(json.email).toBe('someone@example.com');
  });
});
