import {
  SecretsManagerClient,
  GetSecretValueCommand
} from '@aws-sdk/client-secrets-manager';
import { getConfig } from './config.js';

/**
 * Tiny Secrets Manager wrapper with an in-memory cache that survives warm Lambda
 * invocations. Cache entries never expire within a single execution environment
 * — when the secret rotates, AWS recycles the container before long.
 */

type SecretValue = string;

const cache = new Map<string, Promise<SecretValue>>();

let _client: SecretsManagerClient | undefined;

function client(): SecretsManagerClient {
  if (!_client) {
    _client = new SecretsManagerClient({ region: getConfig().AWS_REGION });
  }
  return _client;
}

export async function getSecret(secretId: string): Promise<string> {
  const existing = cache.get(secretId);
  if (existing) return existing;

  const promise = (async () => {
    const res = await client().send(new GetSecretValueCommand({ SecretId: secretId }));
    if (!res.SecretString) {
      throw new Error(`Secret ${secretId} has no SecretString`);
    }
    return res.SecretString;
  })();

  // Cache the *promise* so concurrent callers share the same in-flight request.
  cache.set(secretId, promise);
  try {
    return await promise;
  } catch (err) {
    cache.delete(secretId);
    throw err;
  }
}

/** Test-only escape hatch. */
export function _resetSecretsCache(): void {
  cache.clear();
  _client = undefined;
}

/**
 * Helper: fetch a secret, optionally honouring an inline override env var (handy
 * for local dev where we don't want to hit Secrets Manager).
 */
export async function getSecretOrEnv(
  inlineEnvValue: string | undefined,
  secretId: string
): Promise<string> {
  if (inlineEnvValue && inlineEnvValue.length > 0) return inlineEnvValue;
  return getSecret(secretId);
}
