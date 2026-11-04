import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseRegistry, normalizeEnvId, UnknownEnvError } from '../lib/gs-instances.js';
import { pairKey, envMainKey, pointerLocation } from '../lib/settings-dynamo.js';
import { bucketKey } from '../middleware/rate-limit.js';
import { resetConfigCache } from '../lib/config.js';

const baseEnv: Record<string, string> = {
  ENVIRONMENT: 'staging',
  DYNAMO_OAUTH_STATE_TABLE: 'state-test',
  DYNAMO_OAUTH_SESSIONS_TABLE: 'sessions-test',
  DYNAMO_ACCOUNT_SETTINGS_POINTER_TABLE: 'ptr-test',
  DYNAMO_ACCOUNT_SETTINGS_VERSION_TABLE: 'ver-test',
  DYNAMO_ACCOUNT_SETTINGS_RATE_LIMIT_TABLE: 'rl-test',
  DYNAMO_ACCOUNT_SETTINGS_ENV_POINTER_TABLE: 'env-ptr-test',
  S3_UPLOADS_BUCKET: 'uploads-test',
  S3_PACKSHOTS_BUCKET: 'packshots-test',
  PUBLIC_BASE_URL: 'http://localhost:3000',
  SECRET_GS_OAUTH_CLIENT_ID: 'cid',
  SECRET_GS_OAUTH_CLIENT_SECRET: 'csec',
  SECRET_GS_OAUTH_BASE_URL: 'burl',
  SECRET_PHOTOROOM_API_KEY: 'pr',
  SECRET_AUTORETOUCH_API_KEY: 'ar'
};

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const [k, v] of Object.entries(baseEnv)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  resetConfigCache();
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetConfigCache();
});

const gl = { api_base_url: 'https://api-gl.grand-shooting.com', web_base_url: 'https://gl.grand-shooting.com' };

describe('parseRegistry', () => {
  it('parses a valid registry, OAuth credentials optional', () => {
    const r = parseRegistry(
      JSON.stringify({
        gl,
        'acme-2': { ...gl, api_base_url: 'https://api-acme.grand-shooting.com/', oauth_client_id: 'id', oauth_client_secret: 's' }
      })
    );
    expect(r.get('gl')).toEqual({
      envId: 'gl',
      apiBaseUrl: 'https://api-gl.grand-shooting.com',
      webBaseUrl: 'https://gl.grand-shooting.com',
      oauthClientId: undefined,
      oauthClientSecret: undefined
    });
    // Trailing slash normalised to the origin.
    expect(r.get('acme-2')?.apiBaseUrl).toBe('https://api-acme.grand-shooting.com');
    expect(r.get('acme-2')?.oauthClientSecret).toBe('s');
  });

  it.each(['', '  ', 'REPLACE_ME', '{}'])('%j → empty registry', (raw) => {
    expect(parseRegistry(raw).size).toBe(0);
  });

  it.each([
    ['not JSON', 'nope'],
    ['an array', '[]'],
    ['"shared" declared', JSON.stringify({ shared: gl })],
    ['uppercase id', JSON.stringify({ GL: gl })],
    ['id starting with a digit', JSON.stringify({ '34': gl })],
    ['id with a dot', JSON.stringify({ 'g.l': gl })],
    ['http api url (outside development)', JSON.stringify({ gl: { ...gl, api_base_url: 'http://api-gl.grand-shooting.com' } })],
    ['api url with a path', JSON.stringify({ gl: { ...gl, api_base_url: 'https://api-gl.grand-shooting.com/v3' } })],
    ['api url with a query', JSON.stringify({ gl: { ...gl, api_base_url: 'https://api-gl.grand-shooting.com/?x=1' } })],
    ['api url with credentials', JSON.stringify({ gl: { ...gl, api_base_url: 'https://u:p@api-gl.grand-shooting.com' } })],
    ['non-http scheme', JSON.stringify({ gl: { ...gl, api_base_url: 'file:///etc/passwd' } })],
    ['missing web_base_url', JSON.stringify({ gl: { api_base_url: gl.api_base_url } })],
    ['unknown field', JSON.stringify({ gl: { ...gl, extra: 1 } })]
  ])('rejects %s', (_label, raw) => {
    expect(() => parseRegistry(raw)).toThrow();
  });

  it('does not leak an OAuth secret in the error message', () => {
    const raw = JSON.stringify({ gl: { ...gl, api_base_url: 'http://x.example.com', oauth_client_secret: 'TOP-SECRET' } });
    expect(() => parseRegistry(raw)).toThrow(/^(?!.*TOP-SECRET)/s);
  });

  it('allows http only in development', () => {
    process.env.ENVIRONMENT = 'development';
    resetConfigCache();
    const r = parseRegistry(JSON.stringify({ local: { api_base_url: 'http://localhost:8080', web_base_url: 'http://localhost:3001' } }));
    expect(r.get('local')?.apiBaseUrl).toBe('http://localhost:8080');
  });
});

describe('normalizeEnvId', () => {
  it.each([
    [undefined, 'shared'],
    [null, 'shared'],
    ['', 'shared'],
    ['  ', 'shared'],
    ['shared', 'shared'],
    [' GL ', 'gl']
  ])('%j → %j', (raw, expected) => {
    expect(normalizeEnvId(raw)).toBe(expected);
  });

  it.each(['https://evil.com', '../x', 'a b', 'x'.repeat(40), '9gl'])('%j → UnknownEnvError', (raw) => {
    expect(() => normalizeEnvId(raw)).toThrow(UnknownEnvError);
  });
});

describe('storage partitioning keys', () => {
  it('shared keeps historical keys; dedicated envs are prefixed', () => {
    expect(pairKey('shared', 16, 957)).toBe('16#957');
    expect(pairKey('gl', 16, 957)).toBe('gl#16#957');
    expect(envMainKey('gl', 16)).toBe('gl#16');
    expect(bucketKey('shared', 'pull#16')).toBe('pull#16');
    expect(bucketKey('gl', 'pull#16')).toBe('gl#pull#16');
  });

  it('pointer location: shared → historical table/key, dedicated → env pointer table', () => {
    expect(pointerLocation('shared', 16, 957)).toEqual({
      table: 'ptr-test',
      key: { main_account_id: 16, active_account_id: 957 }
    });
    expect(pointerLocation('gl', 16, 957)).toEqual({
      table: 'env-ptr-test',
      key: { env_main: 'gl#16', active_account_id: 957 }
    });
  });

  it('dedicated env without the env pointer table configured → throws', () => {
    delete process.env.DYNAMO_ACCOUNT_SETTINGS_ENV_POINTER_TABLE;
    resetConfigCache();
    expect(() => pointerLocation('gl', 16, 957)).toThrow(/ENV_POINTER_TABLE/);
    // shared still works.
    expect(pointerLocation('shared', 16, 957).table).toBe('ptr-test');
  });
});
