import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
  GetCommand
} from '@aws-sdk/lib-dynamodb';
import { getConfig } from './config.js';
import type { OAuthSessionRecord, OAuthStateRecord } from '@gs-mobile-backend/core';

let _doc: DynamoDBDocumentClient | undefined;

function doc(): DynamoDBDocumentClient {
  if (_doc) return _doc;
  const raw = new DynamoDBClient({ region: getConfig().AWS_REGION });
  _doc = DynamoDBDocumentClient.from(raw, {
    marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true }
  });
  return _doc;
}

// =============================================================================
// OAuth state (CSRF token store)
// =============================================================================

const STATE_TTL_SECONDS = 5 * 60;

export async function putOAuthState(state: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const record: OAuthStateRecord = {
    state,
    created_at: now,
    expires_at: now + STATE_TTL_SECONDS
  };
  await doc().send(
    new PutCommand({
      TableName: getConfig().DYNAMO_OAUTH_STATE_TABLE,
      Item: record,
      // Defensive: refuse to overwrite an in-flight state with the same value.
      ConditionExpression: 'attribute_not_exists(#s)',
      ExpressionAttributeNames: { '#s': 'state' }
    })
  );
}

/** Returns the record if found, then deletes it (one-shot consume). */
export async function consumeOAuthState(state: string): Promise<OAuthStateRecord | null> {
  const tableName = getConfig().DYNAMO_OAUTH_STATE_TABLE;
  const res = await doc().send(
    new GetCommand({ TableName: tableName, Key: { state } })
  );
  if (!res.Item) return null;

  await doc().send(new DeleteCommand({ TableName: tableName, Key: { state } }));

  const item = res.Item as OAuthStateRecord;
  // DynamoDB TTL is eventually consistent — enforce expiry ourselves.
  if (item.expires_at < Math.floor(Date.now() / 1000)) return null;
  return item;
}

// =============================================================================
// OAuth sessions (one-shot token bag exchanged for tokens)
// =============================================================================

const SESSION_TTL_SECONDS = 60;

export async function putOAuthSession(record: Omit<OAuthSessionRecord, 'expires_at' | 'created_at'>): Promise<OAuthSessionRecord> {
  const now = Math.floor(Date.now() / 1000);
  const full: OAuthSessionRecord = {
    ...record,
    created_at: now,
    expires_at: now + SESSION_TTL_SECONDS
  };
  await doc().send(
    new PutCommand({
      TableName: getConfig().DYNAMO_OAUTH_SESSIONS_TABLE,
      Item: full
    })
  );
  return full;
}

/** Reads then deletes the session. Returns null if not found / expired. */
export async function consumeOAuthSession(sessionId: string): Promise<OAuthSessionRecord | null> {
  const tableName = getConfig().DYNAMO_OAUTH_SESSIONS_TABLE;
  const res = await doc().send(
    new GetCommand({ TableName: tableName, Key: { session_id: sessionId } })
  );
  if (!res.Item) return null;

  await doc().send(
    new DeleteCommand({ TableName: tableName, Key: { session_id: sessionId } })
  );

  const item = res.Item as OAuthSessionRecord;
  if (item.expires_at < Math.floor(Date.now() / 1000)) return null;
  return item;
}

/** Test-only escape hatch. */
export function _resetDynamoClient(): void {
  _doc = undefined;
}
