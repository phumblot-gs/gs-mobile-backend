import { GSMeResponseZ, type GSMeResponse } from '@gs-mobile-backend/core';

export interface Identity {
  email?: string;
  account_id?: number;
  company?: string;
  user_uid?: number;
  user_name?: string;
  accounts?: Array<{ account_id: number; company: string }>;
}

/**
 * Fetches the authenticated user's identity from `GET /me` on the GS OAuth
 * host. Returns an empty identity (all fields undefined) on any failure —
 * callers in the OAuth flow must never break sign-in over a /me failure.
 *
 * For the identity middleware on settings routes, callers must distinguish
 * "401 means token rejected" from "5xx means upstream down" — use
 * `fetchMeStrict` for that.
 */
export async function fetchMe(
  accessToken: string,
  oauthBaseUrl: string
): Promise<Identity> {
  try {
    const me = await fetchMeStrict(accessToken, oauthBaseUrl);
    return meToIdentity(me);
  } catch (err) {
    console.warn('[me] best-effort lookup failed', {
      message: (err as Error).message
    });
    return {};
  }
}

/**
 * Authorization schemes GS understands. `access_token` is used for OAuth-issued
 * tokens; `Bearer` for personal API keys (account-management module). GS
 * rejects a token presented with the wrong scheme, so we relay exactly what
 * the client sent.
 */
export type AuthScheme = 'Bearer' | 'access_token';

export type MeStrictError =
  | { kind: 'unauthorized'; status: number }
  | { kind: 'upstream'; status: number; body?: string }
  | { kind: 'transport'; message: string }
  | { kind: 'malformed' };

/**
 * Calls /me and throws a structured error on any non-2xx, so the identity
 * middleware can map 401 → 401, 5xx → 502, and a JSON-parse failure → 502.
 */
export async function fetchMeStrict(
  accessToken: string,
  apiBaseUrl: string,
  scheme: AuthScheme = 'access_token'
): Promise<GSMeResponse> {
  // The endpoint historically advertised as `/me` is actually exposed under
  // `/v3/account/me` on the GS API host. The OAuth host serves a 404 for `/me`.
  const url = new URL('/v3/account/me', apiBaseUrl).toString();
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        // Relay the client's scheme verbatim. OAuth tokens must be presented
        // as `access_token` (GS answers 401 "Missing authentication" to an
        // OAuth token sent as `Bearer`); personal API keys must be presented
        // as `Bearer`. The default (`access_token`) covers the OAuth flow
        // callers (`fetchMe`), which only ever hold OAuth tokens.
        authorization: `${scheme} ${accessToken}`,
        accept: 'application/json'
      }
    });
  } catch (err) {
    throw { kind: 'transport', message: (err as Error).message } satisfies MeStrictError;
  }
  // GS returns 404 (not 401) for an invalid or missing OAuth token; we treat
  // every 4xx from /me as a credential issue from the client's perspective.
  if (res.status >= 400 && res.status < 500) {
    throw { kind: 'unauthorized', status: res.status } satisfies MeStrictError;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => undefined);
    throw {
      kind: 'upstream',
      status: res.status,
      body: body?.slice(0, 500)
    } satisfies MeStrictError;
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw { kind: 'malformed' } satisfies MeStrictError;
  }
  const parsed = GSMeResponseZ.safeParse(json);
  if (!parsed.success) {
    throw { kind: 'malformed' } satisfies MeStrictError;
  }
  return parsed.data;
}

export function meToIdentity(me: GSMeResponse): Identity {
  return {
    email: me.email,
    account_id: me.account_id,
    company: me.company,
    user_uid: me.user_uid,
    user_name: me.firstname,
    accounts: me.accounts
  };
}

/**
 * Redacts an email for logging: `john.doe@example.com` → `j***@example.com`.
 */
export function redactEmail(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}
