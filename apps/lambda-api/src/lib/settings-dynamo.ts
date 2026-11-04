import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand,
  TransactWriteCommand
} from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ulid } from 'ulid';
import {
  type AccountSettingsPointerRecord,
  type AccountSettingsVersionRecord,
  SETTINGS_HISTORY_CAP_PER_PAIR
} from '@gs-mobile-backend/core';
import { getConfig } from './config.js';
import { SHARED_ENV } from './gs-instances.js';

let _doc: DynamoDBDocumentClient | undefined;
function doc(): DynamoDBDocumentClient {
  if (_doc) return _doc;
  const raw = new DynamoDBClient({ region: getConfig().AWS_REGION });
  _doc = DynamoDBDocumentClient.from(raw, {
    marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true }
  });
  return _doc;
}

export function _resetSettingsDynamoClient(): void {
  _doc = undefined;
}

export function newVersionId(): string {
  return ulid();
}

// ===========================================================================
// Partitioning by GS instance (`env`)
// ===========================================================================
//
// account ids are only unique within one GS instance, so every key is scoped
// by env. `shared` keeps the historical keys byte-for-byte (no migration);
// dedicated instances get an `<env>#` prefix:
//
//   | data              | shared                          | dedicated (e.g. gl)                     |
//   |-------------------|---------------------------------|-----------------------------------------|
//   | version PK (S)    | "16#957"                        | "gl#16#957"                             |
//   | pointer           | pointer table, PK main (N)      | env pointer table, PK env_main "gl#16"  |
//
// The pointer table's PK is numeric and can't hold a prefix, hence a second
// pointer table shared by all dedicated instances. No collision is possible:
// shared keys start with a digit, env ids start with a letter and can't be
// `shared`.

function isShared(env: string): boolean {
  return env === SHARED_ENV;
}

/** Version-table PK for a pair. Exported for tests. */
export function pairKey(env: string, mainAccountId: number, activeAccountId: number): string {
  const base = `${mainAccountId}#${activeAccountId}`;
  return isShared(env) ? base : `${env}#${base}`;
}

/** PK value of the env pointer table. Exported for tests. */
export function envMainKey(env: string, mainAccountId: number): string {
  return `${env}#${mainAccountId}`;
}

function envPointerTable(): string {
  const t = getConfig().DYNAMO_ACCOUNT_SETTINGS_ENV_POINTER_TABLE;
  if (!t) {
    throw new Error('DYNAMO_ACCOUNT_SETTINGS_ENV_POINTER_TABLE is not configured');
  }
  return t;
}

/** Pointer table + key for a pair. Exported for tests. */
export function pointerLocation(
  env: string,
  mainAccountId: number,
  activeAccountId: number
): { table: string; key: Record<string, string | number> } {
  if (isShared(env)) {
    return {
      table: getConfig().DYNAMO_ACCOUNT_SETTINGS_POINTER_TABLE,
      key: { main_account_id: mainAccountId, active_account_id: activeAccountId }
    };
  }
  return {
    table: envPointerTable(),
    key: { env_main: envMainKey(env, mainAccountId), active_account_id: activeAccountId }
  };
}

/** Adds the env partition attributes to a pointer item (no-op for shared). */
function withPointerEnv(
  env: string,
  item: AccountSettingsPointerRecord
): AccountSettingsPointerRecord {
  if (isShared(env)) return item;
  return { ...item, env, env_main: envMainKey(env, item.main_account_id) };
}

// ===========================================================================
// Pointer table
// ===========================================================================

export async function getPointer(
  env: string,
  mainAccountId: number,
  activeAccountId: number
): Promise<AccountSettingsPointerRecord | null> {
  const loc = pointerLocation(env, mainAccountId, activeAccountId);
  const res = await doc().send(new GetCommand({ TableName: loc.table, Key: loc.key }));
  return (res.Item as AccountSettingsPointerRecord | undefined) ?? null;
}

export async function listPointers(
  env: string,
  mainAccountId: number
): Promise<AccountSettingsPointerRecord[]> {
  const res = await doc().send(
    isShared(env)
      ? new QueryCommand({
          TableName: getConfig().DYNAMO_ACCOUNT_SETTINGS_POINTER_TABLE,
          KeyConditionExpression: 'main_account_id = :m',
          ExpressionAttributeValues: { ':m': mainAccountId }
        })
      : new QueryCommand({
          TableName: envPointerTable(),
          KeyConditionExpression: 'env_main = :m',
          ExpressionAttributeValues: { ':m': envMainKey(env, mainAccountId) }
        })
  );
  return (res.Items ?? []) as AccountSettingsPointerRecord[];
}

// ===========================================================================
// Version table
// ===========================================================================

export async function getVersion(
  env: string,
  mainAccountId: number,
  activeAccountId: number,
  versionId: string
): Promise<AccountSettingsVersionRecord | null> {
  const res = await doc().send(
    new GetCommand({
      TableName: getConfig().DYNAMO_ACCOUNT_SETTINGS_VERSION_TABLE,
      Key: { account_pair: pairKey(env, mainAccountId, activeAccountId), version_id: versionId }
    })
  );
  return (res.Item as AccountSettingsVersionRecord | undefined) ?? null;
}

export async function queryAllVersions(
  env: string,
  mainAccountId: number,
  activeAccountId: number
): Promise<AccountSettingsVersionRecord[]> {
  // ULID sorted DESC => most recent first.
  const res = await doc().send(
    new QueryCommand({
      TableName: getConfig().DYNAMO_ACCOUNT_SETTINGS_VERSION_TABLE,
      KeyConditionExpression: 'account_pair = :p',
      ExpressionAttributeValues: { ':p': pairKey(env, mainAccountId, activeAccountId) },
      ScanIndexForward: false
    })
  );
  return (res.Items ?? []) as AccountSettingsVersionRecord[];
}

/**
 * Push a new version + update pointer atomically. Old versions beyond the
 * cap (50) are hard-deleted in best-effort follow-up writes — the cap is
 * loose, not exact.
 *
 * Returns the new pointer.
 */
export async function pushVersion(args: {
  env: string;
  mainAccountId: number;
  activeAccountId: number;
  settingsBlob: string;
  settingsHash: string;
  userUid: number;
  userName: string;
  now: string;
}): Promise<AccountSettingsPointerRecord> {
  const versionId = newVersionId();
  const account_pair = pairKey(args.env, args.mainAccountId, args.activeAccountId);

  const versionItem: AccountSettingsVersionRecord = {
    account_pair,
    ...(isShared(args.env) ? {} : { env: args.env }),
    version_id: versionId,
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

  const pointerItem: AccountSettingsPointerRecord = withPointerEnv(args.env, {
    main_account_id: args.mainAccountId,
    active_account_id: args.activeAccountId,
    current_version_id: versionId,
    updated_at: args.now,
    updated_by_user_uid: args.userUid,
    updated_by_user_name: args.userName,
    last_action: 'push',
    last_restored_from_version_id: null
  });
  const pointerTable = pointerLocation(args.env, args.mainAccountId, args.activeAccountId).table;

  await doc().send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: getConfig().DYNAMO_ACCOUNT_SETTINGS_VERSION_TABLE,
            Item: versionItem
          }
        },
        {
          Put: {
            TableName: pointerTable,
            Item: pointerItem
          }
        }
      ]
    })
  );

  // Purge old non-deleted versions beyond the cap, except the new current.
  await purgeOldVersions(args.env, args.mainAccountId, args.activeAccountId, versionId);

  return pointerItem;
}

async function purgeOldVersions(
  env: string,
  mainAccountId: number,
  activeAccountId: number,
  currentVersionId: string
): Promise<void> {
  const all = await queryAllVersions(env, mainAccountId, activeAccountId);
  const active = all.filter((v) => v.deleted_at === null);
  if (active.length <= SETTINGS_HISTORY_CAP_PER_PAIR) return;

  // active is sorted DESC by version_id (=creation). The oldest live at the
  // tail. Drop everything past the cap, but never the current one.
  const toDelete = active.slice(SETTINGS_HISTORY_CAP_PER_PAIR);
  await Promise.all(
    toDelete
      .filter((v) => v.version_id !== currentVersionId)
      .map((v) =>
        doc().send(
          new DeleteCommand({
            TableName: getConfig().DYNAMO_ACCOUNT_SETTINGS_VERSION_TABLE,
            Key: { account_pair: v.account_pair, version_id: v.version_id }
          })
        )
      )
  );
}

/** Move the pointer to an existing version (restore). */
export async function restorePointer(args: {
  env: string;
  mainAccountId: number;
  activeAccountId: number;
  versionId: string;
  userUid: number;
  userName: string;
  now: string;
}): Promise<AccountSettingsPointerRecord> {
  const item: AccountSettingsPointerRecord = withPointerEnv(args.env, {
    main_account_id: args.mainAccountId,
    active_account_id: args.activeAccountId,
    current_version_id: args.versionId,
    updated_at: args.now,
    updated_by_user_uid: args.userUid,
    updated_by_user_name: args.userName,
    last_action: 'restore',
    last_restored_from_version_id: args.versionId
  });
  await doc().send(
    new PutCommand({
      TableName: pointerLocation(args.env, args.mainAccountId, args.activeAccountId).table,
      Item: item
    })
  );
  return item;
}

/** Soft-delete a history version. Caller checks it isn't the current. */
export async function softDeleteVersion(args: {
  env: string;
  mainAccountId: number;
  activeAccountId: number;
  versionId: string;
  userUid: number;
  userName: string;
  now: string;
}): Promise<void> {
  await doc().send(
    new UpdateCommand({
      TableName: getConfig().DYNAMO_ACCOUNT_SETTINGS_VERSION_TABLE,
      Key: {
        account_pair: pairKey(args.env, args.mainAccountId, args.activeAccountId),
        version_id: args.versionId
      },
      UpdateExpression:
        'SET deleted_at = :now, deleted_by_user_uid = :uid, deleted_by_user_name = :name',
      ExpressionAttributeValues: {
        ':now': args.now,
        ':uid': args.userUid,
        ':name': args.userName
      },
      ConditionExpression: 'attribute_exists(version_id)'
    })
  );
}

/**
 * Just write the pointer (used by the no-op path on POST to refresh nothing).
 * Provided so handlers don't reach for PutCommand directly.
 */
export async function putPointer(
  env: string,
  item: AccountSettingsPointerRecord
): Promise<void> {
  await doc().send(
    new PutCommand({
      TableName: pointerLocation(env, item.main_account_id, item.active_account_id).table,
      Item: withPointerEnv(env, item)
    })
  );
}
