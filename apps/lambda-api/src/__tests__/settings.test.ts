import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ulid } from 'ulid';

// =============================================================================
// In-memory stubs for the settings dynamo tables.
// =============================================================================

type PointerRecord = {
  main_account_id: number;
  active_account_id: number;
  current_version_id: string;
  updated_at: string;
  updated_by_user_uid: number;
  updated_by_user_name: string;
  last_action: 'push' | 'restore';
  last_restored_from_version_id: string | null;
};
type VersionRecord = {
  account_pair: string;
  version_id: string;
  main_account_id: number;
  active_account_id: number;
  settings_blob: string;
  settings_hash: string;
  created_at: string;
  created_by_user_uid: number;
  created_by_user_name: string;
  deleted_at: string | null;
  deleted_by_user_uid: number | null;
  deleted_by_user_name: string | null;
};

const pointers = new Map<string, PointerRecord>();
const versions = new Map<string, VersionRecord>();
const pairKey = (m: number, a: number) => `${m}#${a}`;
const ptrKey = (m: number, a: number) => `${m}#${a}`;
const verKey = (pair: string, ulidVal: string) => `${pair}#${ulidVal}`;

let nextUlid: (() => string) | null = null;

vi.mock('../lib/settings-dynamo.js', async () => {
  const real = await vi.importActual<typeof import('../lib/settings-dynamo.js')>(
    '../lib/settings-dynamo.js'
  );
  return {
    ...real,
    newVersionId: () => (nextUlid ? nextUlid() : ulid()),
    getPointer: vi.fn(async (m: number, a: number) => pointers.get(ptrKey(m, a)) ?? null),
    listPointers: vi.fn(async (m: number) =>
      [...pointers.values()].filter((p) => p.main_account_id === m)
    ),
    getVersion: vi.fn(async (m: number, a: number, vid: string) =>
      versions.get(verKey(pairKey(m, a), vid)) ?? null
    ),
    queryAllVersions: vi.fn(async (m: number, a: number) =>
      [...versions.values()]
        .filter((v) => v.account_pair === pairKey(m, a))
        .sort((x, y) => (x.version_id < y.version_id ? 1 : -1))
    ),
    pushVersion: vi.fn(async (args: {
      mainAccountId: number;
      activeAccountId: number;
      settingsBlob: string;
      settingsHash: string;
      userUid: number;
      userName: string;
      now: string;
    }) => {
      const vid = nextUlid ? nextUlid() : ulid();
      const pair = pairKey(args.mainAccountId, args.activeAccountId);
      const vRec: VersionRecord = {
        account_pair: pair,
        version_id: vid,
        main_account_id: args.mainAccountId,
        active_account_id: args.activeAccountId,
        settings_blob: args.settingsBlob,
        settings_hash: args.settingsHash,
        created_at: args.now,
        created_by_user_uid: args.userUid,
        created_by_user_name: args.userName,
        deleted_at: null,
        deleted_by_user_uid: null,
        deleted_by_user_name: null
      };
      versions.set(verKey(pair, vid), vRec);
      const pRec: PointerRecord = {
        main_account_id: args.mainAccountId,
        active_account_id: args.activeAccountId,
        current_version_id: vid,
        updated_at: args.now,
        updated_by_user_uid: args.userUid,
        updated_by_user_name: args.userName,
        last_action: 'push',
        last_restored_from_version_id: null
      };
      pointers.set(ptrKey(args.mainAccountId, args.activeAccountId), pRec);
      return pRec;
    }),
    restorePointer: vi.fn(async (args: {
      mainAccountId: number;
      activeAccountId: number;
      versionId: string;
      userUid: number;
      userName: string;
      now: string;
    }) => {
      const pRec: PointerRecord = {
        main_account_id: args.mainAccountId,
        active_account_id: args.activeAccountId,
        current_version_id: args.versionId,
        updated_at: args.now,
        updated_by_user_uid: args.userUid,
        updated_by_user_name: args.userName,
        last_action: 'restore',
        last_restored_from_version_id: args.versionId
      };
      pointers.set(ptrKey(args.mainAccountId, args.activeAccountId), pRec);
      return pRec;
    }),
    softDeleteVersion: vi.fn(async (args: {
      mainAccountId: number;
      activeAccountId: number;
      versionId: string;
      userUid: number;
      userName: string;
      now: string;
    }) => {
      const pair = pairKey(args.mainAccountId, args.activeAccountId);
      const v = versions.get(verKey(pair, args.versionId));
      if (!v) throw new Error('not found');
      v.deleted_at = args.now;
      v.deleted_by_user_uid = args.userUid;
      v.deleted_by_user_name = args.userName;
    }),
    putPointer: vi.fn(async (rec: PointerRecord) => {
      pointers.set(ptrKey(rec.main_account_id, rec.active_account_id), rec);
    })
  };
});

// Rate limit: always allow by default. Individual tests can override.
const rateLimitOutcome: { allowed: boolean; retryAfterSeconds: number } = {
  allowed: true,
  retryAfterSeconds: 0
};
vi.mock('../lib/rate-limit-dynamo.js', () => ({
  consumeRateLimit: vi.fn(async () => rateLimitOutcome),
  _resetRateLimitDynamoClient: vi.fn()
}));

// Stub secrets so identity middleware can resolve baseUrl.
vi.mock('../lib/secrets.js', () => ({
  getSecret: vi.fn(async () => 'secret-value'),
  getSecretOrEnv: vi.fn(async (inline: string | undefined, _id: string) => inline ?? 'secret-value'),
  _resetSecretsCache: vi.fn()
}));

// Stub the OAuth dynamo too — not used by settings tests but the app imports
// from it, so we need a working mock.
vi.mock('../lib/dynamo.js', () => ({
  putOAuthState: vi.fn(),
  consumeOAuthState: vi.fn(),
  putOAuthSession: vi.fn(),
  consumeOAuthSession: vi.fn(),
  _resetDynamoClient: vi.fn()
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
  SECRET_GS_OAUTH_CLIENT_ID: 'cid',
  SECRET_GS_OAUTH_CLIENT_SECRET: 'csec',
  SECRET_GS_OAUTH_BASE_URL: 'burl',
  SECRET_PHOTOROOM_API_KEY: 'pr',
  SECRET_AUTORETOUCH_API_KEY: 'ar',
  GS_OAUTH_CLIENT_ID: 'test-client-id',
  GS_OAUTH_CLIENT_SECRET: 'test-client-secret',
  GS_OAUTH_BASE_URL: 'https://api.grand-shooting.com'
};

// Standard /me response stubbed at the network level.
function stubMe(opts: {
  accountId?: number;
  userUid?: number;
  firstname?: string;
  email?: string;
  accounts?: Array<{ account_id: number; company: string }>;
  status?: number;
}): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request | URL).toString();
    if (url.endsWith('/me')) {
      if (opts.status && opts.status >= 400) {
        return new Response('error', { status: opts.status });
      }
      return new Response(
        JSON.stringify({
          firstname: opts.firstname ?? 'Paul H.',
          email: opts.email ?? 'paul@grand-shooting.com',
          account_id: opts.accountId ?? 16,
          user_uid: opts.userUid ?? 8836,
          accounts: opts.accounts ?? [
            { account_id: 16, company: 'Grand shooting' },
            { account_id: 957, company: 'Courrèges' }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    return new Response('not stubbed', { status: 500 });
  });
}

beforeEach(async () => {
  pointers.clear();
  versions.clear();
  nextUlid = null;
  rateLimitOutcome.allowed = true;
  rateLimitOutcome.retryAfterSeconds = 0;
  for (const [k, v] of Object.entries(baseEnv)) process.env[k] = v;
  const { resetConfigCache } = await import('../lib/config.js');
  resetConfigCache();
  const { _resetIdentityCache } = await import('../middleware/identity.js');
  _resetIdentityCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const AUTH_HEADER = { authorization: 'Bearer fake-access-token', 'content-type': 'application/json' };

describe('settings handlers', () => {
  it('GET /account/settings — 401 without Authorization', async () => {
    const { app } = await import('../index.js');
    const res = await app.request('/account/settings');
    expect(res.status).toBe(401);
  });

  it('GET /account/settings — empty list when nothing stored', async () => {
    stubMe({});
    const { app } = await import('../index.js');
    const res = await app.request('/account/settings', { headers: AUTH_HEADER });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { items: unknown[]; next_cursor: null };
    expect(json.items).toEqual([]);
    expect(json.next_cursor).toBeNull();
  });

  it('full happy path: POST → GET → list → history → restore → delete', async () => {
    stubMe({});
    const { app } = await import('../index.js');

    // 1. POST settings — creates pointer + v1
    nextUlid = (() => {
      const ids = ['01HVAAAAAAAAAAAAAAAAAAAA00', '01HVBBBBBBBBBBBBBBBBBBBB00'];
      let i = 0;
      return () => ids[i++]!;
    })();
    const push1 = await app.request('/account/settings/957', {
      method: 'POST',
      headers: AUTH_HEADER,
      body: JSON.stringify({ settings_blob: { lang: 'fr', photoQuality: 'high' } })
    });
    expect(push1.status).toBe(200);
    const ptr1 = (await push1.json()) as {
      current_version_id: string;
      current_version_hash: string;
      active_account_name: string;
      last_action: string;
      settings_blob: Record<string, unknown>;
    };
    expect(ptr1.current_version_id).toBe('01HVAAAAAAAAAAAAAAAAAAAA00');
    expect(ptr1.active_account_name).toBe('Courrèges');
    expect(ptr1.last_action).toBe('push');
    expect(ptr1.settings_blob).toEqual({ lang: 'fr', photoQuality: 'high' });

    // 2. POST same blob — no-op, same version
    const push1Bis = await app.request('/account/settings/957', {
      method: 'POST',
      headers: AUTH_HEADER,
      body: JSON.stringify({ settings_blob: { photoQuality: 'high', lang: 'fr' } }) // key order swapped
    });
    expect(push1Bis.status).toBe(200);
    const ptr1Bis = (await push1Bis.json()) as { current_version_id: string };
    expect(ptr1Bis.current_version_id).toBe('01HVAAAAAAAAAAAAAAAAAAAA00');

    // 3. POST different blob — new version
    const push2 = await app.request('/account/settings/957', {
      method: 'POST',
      headers: AUTH_HEADER,
      body: JSON.stringify({ settings_blob: { lang: 'en', photoQuality: 'high' } })
    });
    expect(push2.status).toBe(200);
    const ptr2 = (await push2.json()) as { current_version_id: string };
    expect(ptr2.current_version_id).toBe('01HVBBBBBBBBBBBBBBBBBBBB00');

    // 4. GET /account/settings/957
    const get1 = await app.request('/account/settings/957', { headers: AUTH_HEADER });
    expect(get1.status).toBe(200);
    const got = (await get1.json()) as { current_version_id: string; settings_blob: Record<string, unknown> };
    expect(got.current_version_id).toBe('01HVBBBBBBBBBBBBBBBBBBBB00');
    expect(got.settings_blob).toEqual({ lang: 'en', photoQuality: 'high' });

    // 5. GET history
    const histRes = await app.request('/account/settings/957/history', { headers: AUTH_HEADER });
    expect(histRes.status).toBe(200);
    const hist = (await histRes.json()) as {
      items: Array<{ version_id: string; is_current: boolean }>;
    };
    expect(hist.items).toHaveLength(2);
    expect(hist.items[0]?.version_id).toBe('01HVBBBBBBBBBBBBBBBBBBBB00');
    expect(hist.items[0]?.is_current).toBe(true);
    expect(hist.items[1]?.is_current).toBe(false);

    // 6. GET specific historical version
    const getV1 = await app.request('/account/settings/957/history/01HVAAAAAAAAAAAAAAAAAAAA00', {
      headers: AUTH_HEADER
    });
    expect(getV1.status).toBe(200);
    const v1Detail = (await getV1.json()) as { settings_blob: Record<string, unknown> };
    expect(v1Detail.settings_blob).toEqual({ lang: 'fr', photoQuality: 'high' });

    // 7. Restore v1
    const restoreRes = await app.request(
      '/account/settings/957/history/01HVAAAAAAAAAAAAAAAAAAAA00/restore',
      { method: 'POST', headers: AUTH_HEADER }
    );
    expect(restoreRes.status).toBe(200);
    const restored = (await restoreRes.json()) as {
      current_version_id: string;
      last_action: string;
      last_restored_from_version_id: string;
    };
    expect(restored.current_version_id).toBe('01HVAAAAAAAAAAAAAAAAAAAA00');
    expect(restored.last_action).toBe('restore');
    expect(restored.last_restored_from_version_id).toBe('01HVAAAAAAAAAAAAAAAAAAAA00');

    // 8. Soft-delete v2 (not current after restore)
    const delRes = await app.request('/account/settings/957/history/01HVBBBBBBBBBBBBBBBBBBBB00', {
      method: 'DELETE',
      headers: AUTH_HEADER
    });
    expect(delRes.status).toBe(200);

    // 9. v2 now invisible in history + 404 on GET
    const hist2 = await app.request('/account/settings/957/history', { headers: AUTH_HEADER });
    const hist2Json = (await hist2.json()) as { items: unknown[] };
    expect(hist2Json.items).toHaveLength(1);

    const getDeleted = await app.request(
      '/account/settings/957/history/01HVBBBBBBBBBBBBBBBBBBBB00',
      { headers: AUTH_HEADER }
    );
    expect(getDeleted.status).toBe(404);
  });

  it('POST settings rejects non-object blob with 400', async () => {
    stubMe({});
    const { app } = await import('../index.js');
    const res = await app.request('/account/settings/957', {
      method: 'POST',
      headers: AUTH_HEADER,
      body: JSON.stringify({ settings_blob: [1, 2, 3] })
    });
    expect(res.status).toBe(400);
  });

  it('POST settings rejects blob > 16 KB with 413', async () => {
    stubMe({});
    const { app } = await import('../index.js');
    // Generate ~17 KB of string content.
    const big = 'x'.repeat(17 * 1024);
    const res = await app.request('/account/settings/957', {
      method: 'POST',
      headers: AUTH_HEADER,
      body: JSON.stringify({ settings_blob: { payload: big } })
    });
    expect(res.status).toBe(413);
    const json = (await res.json()) as { code: string; details: { max_bytes: number } };
    expect(json.code).toBe('blob_too_large');
    expect(json.details.max_bytes).toBe(16384);
  });

  it('403 when active_account_id not in caller accounts', async () => {
    stubMe({ accounts: [{ account_id: 16, company: 'Grand shooting' }] });
    const { app } = await import('../index.js');
    const res = await app.request('/account/settings/9999', {
      method: 'POST',
      headers: AUTH_HEADER,
      body: JSON.stringify({ settings_blob: { a: 1 } })
    });
    expect(res.status).toBe(403);
  });

  it('GET unknown active_account_id returns 404', async () => {
    stubMe({});
    const { app } = await import('../index.js');
    const res = await app.request('/account/settings/957', { headers: AUTH_HEADER });
    expect(res.status).toBe(404);
  });

  it('409 on restore of already-current version', async () => {
    stubMe({});
    const { app } = await import('../index.js');
    nextUlid = (() => () => '01HVCCCCCCCCCCCCCCCCCCCC00')();
    await app.request('/account/settings/957', {
      method: 'POST',
      headers: AUTH_HEADER,
      body: JSON.stringify({ settings_blob: { a: 1 } })
    });
    const res = await app.request(
      '/account/settings/957/history/01HVCCCCCCCCCCCCCCCCCCCC00/restore',
      { method: 'POST', headers: AUTH_HEADER }
    );
    expect(res.status).toBe(409);
  });

  it('409 on delete of current version', async () => {
    stubMe({});
    const { app } = await import('../index.js');
    nextUlid = (() => () => '01HVDDDDDDDDDDDDDDDDDDDD00')();
    await app.request('/account/settings/957', {
      method: 'POST',
      headers: AUTH_HEADER,
      body: JSON.stringify({ settings_blob: { a: 1 } })
    });
    const res = await app.request(
      '/account/settings/957/history/01HVDDDDDDDDDDDDDDDDDDDD00',
      { method: 'DELETE', headers: AUTH_HEADER }
    );
    expect(res.status).toBe(409);
  });

  it('429 with Retry-After when rate limit denies', async () => {
    stubMe({});
    rateLimitOutcome.allowed = false;
    rateLimitOutcome.retryAfterSeconds = 4;
    const { app } = await import('../index.js');
    const res = await app.request('/account/settings/957', {
      method: 'POST',
      headers: AUTH_HEADER,
      body: JSON.stringify({ settings_blob: { a: 1 } })
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('4');
    const json = (await res.json()) as { code: string; details: { retry_after_seconds: number } };
    expect(json.code).toBe('rate_limited');
    expect(json.details.retry_after_seconds).toBe(4);
  });

  it('401 when /me rejects the token', async () => {
    stubMe({ status: 401 });
    const { app } = await import('../index.js');
    const res = await app.request('/account/settings', { headers: AUTH_HEADER });
    expect(res.status).toBe(401);
  });

  it('502 when /me is down (5xx)', async () => {
    stubMe({ status: 503 });
    const { app } = await import('../index.js');
    const res = await app.request('/account/settings', { headers: AUTH_HEADER });
    expect(res.status).toBe(502);
  });

  it('identity is cached across calls (single /me invocation)', async () => {
    stubMe({});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { app } = await import('../index.js');
    await app.request('/account/settings', { headers: AUTH_HEADER });
    await app.request('/account/settings', { headers: AUTH_HEADER });
    const meCalls = fetchSpy.mock.calls.filter(([input]) =>
      (typeof input === 'string' ? input : (input as Request | URL).toString()).endsWith('/me')
    );
    expect(meCalls.length).toBe(1);
  });
});
