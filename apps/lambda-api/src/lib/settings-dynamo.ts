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

function pairKey(mainAccountId: number, activeAccountId: number): string {
  return `${mainAccountId}#${activeAccountId}`;
}

// ===========================================================================
// Pointer table
// ===========================================================================

export async function getPointer(
  mainAccountId: number,
  activeAccountId: number
): Promise<AccountSettingsPointerRecord | null> {
  const res = await doc().send(
    new GetCommand({
      TableName: getConfig().DYNAMO_ACCOUNT_SETTINGS_POINTER_TABLE,
      Key: { main_account_id: mainAccountId, active_account_id: activeAccountId }
    })
  );
  return (res.Item as AccountSettingsPointerRecord | undefined) ?? null;
}

export async function listPointers(
  mainAccountId: number
): Promise<AccountSettingsPointerRecord[]> {
  const res = await doc().send(
    new QueryCommand({
      TableName: getConfig().DYNAMO_ACCOUNT_SETTINGS_POINTER_TABLE,
      KeyConditionExpression: 'main_account_id = :m',
      ExpressionAttributeValues: { ':m': mainAccountId }
    })
  );
  return (res.Items ?? []) as AccountSettingsPointerRecord[];
}

// ===========================================================================
// Version table
// ===========================================================================

export async function getVersion(
  mainAccountId: number,
  activeAccountId: number,
  versionId: string
): Promise<AccountSettingsVersionRecord | null> {
  const res = await doc().send(
    new GetCommand({
      TableName: getConfig().DYNAMO_ACCOUNT_SETTINGS_VERSION_TABLE,
      Key: { account_pair: pairKey(mainAccountId, activeAccountId), version_id: versionId }
    })
  );
  return (res.Item as AccountSettingsVersionRecord | undefined) ?? null;
}

export async function queryAllVersions(
  mainAccountId: number,
  activeAccountId: number
): Promise<AccountSettingsVersionRecord[]> {
  // ULID sorted DESC => most recent first.
  const res = await doc().send(
    new QueryCommand({
      TableName: getConfig().DYNAMO_ACCOUNT_SETTINGS_VERSION_TABLE,
      KeyConditionExpression: 'account_pair = :p',
      ExpressionAttributeValues: { ':p': pairKey(mainAccountId, activeAccountId) },
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
  mainAccountId: number;
  activeAccountId: number;
  settingsBlob: string;
  settingsHash: string;
  userUid: number;
  userName: string;
  now: string;
}): Promise<AccountSettingsPointerRecord> {
  const versionId = newVersionId();
  const account_pair = pairKey(args.mainAccountId, args.activeAccountId);

  const versionItem: AccountSettingsVersionRecord = {
    account_pair,
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

  const pointerItem: AccountSettingsPointerRecord = {
    main_account_id: args.mainAccountId,
    active_account_id: args.activeAccountId,
    current_version_id: versionId,
    updated_at: args.now,
    updated_by_user_uid: args.userUid,
    updated_by_user_name: args.userName,
    last_action: 'push',
    last_restored_from_version_id: null
  };

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
            TableName: getConfig().DYNAMO_ACCOUNT_SETTINGS_POINTER_TABLE,
            Item: pointerItem
          }
        }
      ]
    })
  );

  // Purge old non-deleted versions beyond the cap, except the new current.
  await purgeOldVersions(args.mainAccountId, args.activeAccountId, versionId);

  return pointerItem;
}

async function purgeOldVersions(
  mainAccountId: number,
  activeAccountId: number,
  currentVersionId: string
): Promise<void> {
  const all = await queryAllVersions(mainAccountId, activeAccountId);
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
  mainAccountId: number;
  activeAccountId: number;
  versionId: string;
  userUid: number;
  userName: string;
  now: string;
}): Promise<AccountSettingsPointerRecord> {
  const item: AccountSettingsPointerRecord = {
    main_account_id: args.mainAccountId,
    active_account_id: args.activeAccountId,
    current_version_id: args.versionId,
    updated_at: args.now,
    updated_by_user_uid: args.userUid,
    updated_by_user_name: args.userName,
    last_action: 'restore',
    last_restored_from_version_id: args.versionId
  };
  await doc().send(
    new PutCommand({
      TableName: getConfig().DYNAMO_ACCOUNT_SETTINGS_POINTER_TABLE,
      Item: item
    })
  );
  return item;
}

/** Soft-delete a history version. Caller checks it isn't the current. */
export async function softDeleteVersion(args: {
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
        account_pair: pairKey(args.mainAccountId, args.activeAccountId),
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
export async function putPointer(item: AccountSettingsPointerRecord): Promise<void> {
  await doc().send(
    new PutCommand({
      TableName: getConfig().DYNAMO_ACCOUNT_SETTINGS_POINTER_TABLE,
      Item: item
    })
  );
}
