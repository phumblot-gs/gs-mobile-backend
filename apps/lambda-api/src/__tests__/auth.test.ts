import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Stub AWS + secrets BEFORE importing the app.
vi.mock('../lib/dynamo.js', () => {
  type Platform = 'ios' | 'android';
  type Account = { account_id: number; company: string };
  type Session = {
    session_id: string;
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    api_base_url: string;
    email?: string;
    account_id?: number;
    user_uid?: number;
    user_name?: string;
    accounts?: Account[];
    platform?: Platform;
    expires_at: number;
    created_at: number;
  };
  const states = new Map<string, { state: string; platform?: Platform; expires_at: number; created_at: number }>();
  const sessions = new Map<string, Session>();
  return {
    putOAuthState: vi.fn(async (state: string, platform?: Platform) => {
      states.set(state, { state, platform, expires_at: Date.now() / 1000 + 300, created_at: Date.now() / 1000 });
    }),
    consumeOAuthState: vi.fn(async (state: string) => {
      const v = states.get(state);
      if (!v) return null;
      states.delete(state);
      return v;
    }),
    putOAuthSession: vi.fn(async (rec: Omit<Session, 'expires_at' | 'created_at'>) => {
      const full: Session = { ...rec, expires_at: Date.now() / 1000 + 60, created_at: Date.now() / 1000 };
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
  DYNAMO_ACCOUNT_SETTINGS_POINTER_TABLE: 'ptr-test',
  DYNAMO_ACCOUNT_SETTINGS_VERSION_TABLE: 'ver-test',
  DYNAMO_ACCOUNT_SETTINGS_RATE_LIMIT_TABLE: 'rl-test',
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
  it('GET /auth/start generates a state and redirects to GS (default platform = ios)', async () => {
    const { resetConfigCache } = await import('../lib/config.js');
    resetConfigCache();
    const dynamo = await import('../lib/dynamo.js');
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

    // Regression: omitted platform must persist as `ios` so the existing iOS
    // client (which never sent the param) keeps working.
    const stateValue = u.searchParams.get('state')!;
    expect((dynamo as unknown as { __states: Map<string, { platform?: string }> }).__states.get(stateValue)?.platform).toBe('ios');
  });

  it('GET /auth/start accepts platform=android', async () => {
    const { resetConfigCache } = await import('../lib/config.js');
    resetConfigCache();
    const dynamo = await import('../lib/dynamo.js');
    const { app } = await import('../index.js');

    const res = await app.request('/auth/start?platform=android');
    expect(res.status).toBe(302);
    const stateValue = new URL(res.headers.get('location')!).searchParams.get('state')!;
    expect((dynamo as unknown as { __states: Map<string, { platform?: string }> }).__states.get(stateValue)?.platform).toBe('android');
  });

  it('GET /auth/start rejects an unknown platform with 400', async () => {
    const { resetConfigCache } = await import('../lib/config.js');
    resetConfigCache();
    const { app } = await import('../index.js');

    const res = await app.request('/auth/start?platform=windows-phone');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('bad_request');
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
      if (url.endsWith('/me')) {
        return new Response(
          JSON.stringify({
            firstname: 'Paul H.',
            email: 'staff@grand-shooting.com',
            account_id: 16,
            user_uid: 8836,
            accounts: [
              { account_id: 16, company: 'Grand shooting' },
              { account_id: 957, company: 'Courrèges' }
            ]
          }),
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
    const json = (await ex.json()) as {
      access_token: string;
      refresh_token: string;
      api_base_url: string;
      email?: string;
      account_id?: number;
      user_uid?: number;
      user_name?: string;
      accounts?: Array<{ account_id: number; company: string }>;
    };
    expect(json.access_token).toBe('tok-access');
    expect(json.refresh_token).toBe('tok-refresh');
    expect(json.api_base_url).toBe('https://api.grand-shooting.com');
    expect(json.email).toBe('staff@grand-shooting.com');
    expect(json.account_id).toBe(16);
    expect(json.user_uid).toBe(8836);
    expect(json.user_name).toBe('Paul H.');
    expect(json.accounts).toEqual([
      { account_id: 16, company: 'Grand shooting' },
      { account_id: 957, company: 'Courrèges' }
    ]);

    // exchange is one-shot — a second call must fail
    const ex2 = await app.request('/auth/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId })
    });
    expect(ex2.status).toBe(401);
  });

  it('end-to-end with platform=android (start → callback → exchange)', async () => {
    const { resetConfigCache } = await import('../lib/config.js');
    resetConfigCache();
    const dynamo = await import('../lib/dynamo.js');
    const { app } = await import('../index.js');

    // 1. /auth/start with platform=android — state is stored with platform.
    const startRes = await app.request('/auth/start?platform=android');
    expect(startRes.status).toBe(302);
    const stateValue = new URL(startRes.headers.get('location')!).searchParams.get('state')!;
    const stateRecord = (dynamo as unknown as {
      __states: Map<string, { platform?: string }>;
    }).__states.get(stateValue);
    expect(stateRecord?.platform).toBe('android');

    // 2. /auth/callback drives the rest with a stubbed token + /me.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request | URL).toString();
      if (url.includes('/oauth/default/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'a-tok',
            refresh_token: 'a-ref',
            token_type: 'bearer',
            expires_in: 3600
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (url.endsWith('/me')) {
        return new Response(
          JSON.stringify({
            firstname: 'Droid',
            email: 'droid@example.com',
            account_id: 957,
            user_uid: 7777,
            accounts: [{ account_id: 957, company: 'Courrèges' }]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response('not stubbed', { status: 500 });
    });

    const cbRes = await app.request(`/auth/callback?code=THECODE&state=${stateValue}`);
    expect(cbRes.status).toBe(302);
    const cbLoc = cbRes.headers.get('location')!;
    // Deep link scheme is shared between iOS and Android (gsmobile://).
    expect(cbLoc.startsWith('gsmobile://auth/done?session_id=')).toBe(true);
    const sessionId = new URL(cbLoc).searchParams.get('session_id')!;

    // Session record carries platform=android for log distinction.
    const sessRecord = (dynamo as unknown as {
      __sessions: Map<string, { platform?: string }>;
    }).__sessions.get(sessionId);
    expect(sessRecord?.platform).toBe('android');

    // 3. /auth/exchange — same payload shape as iOS, no platform in response.
    const ex = await app.request('/auth/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId })
    });
    expect(ex.status).toBe(200);
    const json = (await ex.json()) as Record<string, unknown>;
    expect(json.access_token).toBe('a-tok');
    expect(json.refresh_token).toBe('a-ref');
    expect(json.api_base_url).toBe('https://api.grand-shooting.com');
    expect(json.email).toBe('droid@example.com');
    expect(json.account_id).toBe(957);
    expect(json.user_uid).toBe(7777);
    expect(json).not.toHaveProperty('platform');
  });

  it('GET /auth/callback still succeeds when /me lookup fails', async () => {
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
      // Simulate /me being down / missing.
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
    const json = (await ex.json()) as { access_token: string; email?: string; account_id?: number };
    expect(json.access_token).toBe('tok-access-2');
    expect(json.email).toBeUndefined();
    expect(json.account_id).toBeUndefined();
  });

  it('POST /auth/refresh proxies refresh_token to GS and includes identity', async () => {
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
      if (url.endsWith('/me')) {
        return new Response(
          JSON.stringify({
            firstname: 'Someone',
            email: 'someone@example.com',
            account_id: 42,
            user_uid: 1234,
            accounts: [{ account_id: 42, company: 'Acme' }]
          }),
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
    const json = (await res.json()) as {
      access_token: string;
      email?: string;
      account_id?: number;
      user_uid?: number;
      user_name?: string;
    };
    expect(json.access_token).toBe('new-access');
    expect(json.email).toBe('someone@example.com');
    expect(json.account_id).toBe(42);
    expect(json.user_uid).toBe(1234);
    expect(json.user_name).toBe('Someone');
  });
});
