import { OIDCUserInfoZ } from '@gs-mobile-backend/core';

/**
 * Fetches the authenticated user's profile from the GS OIDC userinfo endpoint
 * and returns their email when present. Returns `undefined` on any failure —
 * this lookup is purely informational (it surfaces dev-only UI in the iOS
 * app for @grand-shooting.com users) and must never break the sign-in flow.
 *
 * Assumes the GS OAuth server follows the Okta/OIDC convention of exposing
 * userinfo as a sibling of /oauth/default/authorize and /oauth/default/token.
 */
export async function fetchUserEmail(
  accessToken: string,
  oauthBaseUrl: string
): Promise<string | undefined> {
  const url = new URL('/oauth/default/userinfo', oauthBaseUrl).toString();

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json'
      }
    });
  } catch (err) {
    console.warn('[userinfo] network error', { message: (err as Error).message });
    return undefined;
  }

  if (!res.ok) {
    console.warn('[userinfo] non-2xx', { status: res.status });
    return undefined;
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return undefined;
  }

  const parsed = OIDCUserInfoZ.safeParse(json);
  if (!parsed.success) return undefined;
  return parsed.data.email;
}

/**
 * Redacts an email for logging: `john.doe@example.com` → `j***@example.com`.
 * Used so we can trace which user signed in without dumping PII in CloudWatch.
 */
export function redactEmail(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  return `${local[0]}***${domain}`;
}
