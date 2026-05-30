import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getConfig } from './config.js';

let _doc: DynamoDBDocumentClient | undefined;
function doc(): DynamoDBDocumentClient {
  if (_doc) return _doc;
  const raw = new DynamoDBClient({ region: getConfig().AWS_REGION });
  _doc = DynamoDBDocumentClient.from(raw, {
    marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true }
  });
  return _doc;
}

export function _resetRateLimitDynamoClient(): void {
  _doc = undefined;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Atomic fixed-window counter. Increments the count for the bucket and
 * returns whether the call is allowed under the given limit.
 *
 * Implementation note: we drive a single Dynamo `UpdateItem` per call:
 *
 *  - if `window_start` doesn't exist OR is older than `windowSeconds`,
 *    reset to a fresh window with count = 1.
 *  - otherwise increment the count.
 *
 * Dynamo doesn't support arbitrary if/else, so we encode this with two
 * conditional updates and a fallback. The fallback path (the window has
 * advanced) is the rarer one.
 *
 * Fail-open: any unexpected Dynamo error propagates `allowed: true` and
 * is logged. Rate limiting is a guard-rail, not a blocker — better to
 * let traffic through than to deny because of an infra hiccup.
 */
export async function consumeRateLimit(args: {
  bucketKey: string;
  windowSeconds: number;
  limit: number;
}): Promise<RateLimitResult> {
  const nowSec = Math.floor(Date.now() / 1000);
  const tableName = getConfig().DYNAMO_ACCOUNT_SETTINGS_RATE_LIMIT_TABLE;
  const windowExpiry = nowSec + args.windowSeconds + 60;

  try {
    // Path 1: existing record, still in the same window — increment.
    const res = await doc().send(
      new UpdateCommand({
        TableName: tableName,
        Key: { bucket_key: args.bucketKey },
        UpdateExpression: 'ADD #c :one SET expires_at = :exp',
        ConditionExpression:
          'attribute_exists(window_start) AND window_start > :win_floor',
        ExpressionAttributeNames: { '#c': 'count' },
        ExpressionAttributeValues: {
          ':one': 1,
          ':exp': windowExpiry,
          ':win_floor': nowSec - args.windowSeconds
        },
        ReturnValues: 'ALL_NEW'
      })
    );
    const count = (res.Attributes?.count as number | undefined) ?? 1;
    const winStart = (res.Attributes?.window_start as number | undefined) ?? nowSec;
    if (count > args.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, winStart + args.windowSeconds - nowSec)
      };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name !== 'ConditionalCheckFailedException') {
      console.warn('[rate-limit] dynamo error, failing open', { error: name });
      return { allowed: true, retryAfterSeconds: 0 };
    }
  }

  // Path 2: either record didn't exist, or its window has expired —
  // reset to a fresh window with count = 1. Best-effort, fail-open.
  try {
    await doc().send(
      new UpdateCommand({
        TableName: tableName,
        Key: { bucket_key: args.bucketKey },
        UpdateExpression:
          'SET #c = :one, window_start = :now, expires_at = :exp',
        ExpressionAttributeNames: { '#c': 'count' },
        ExpressionAttributeValues: {
          ':one': 1,
          ':now': nowSec,
          ':exp': windowExpiry
        }
      })
    );
  } catch (err) {
    console.warn('[rate-limit] reset failed, failing open', {
      error: (err as { name?: string }).name
    });
  }
  return { allowed: true, retryAfterSeconds: 0 };
}
