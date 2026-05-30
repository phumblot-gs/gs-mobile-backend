import type { Context } from 'hono';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  AppError,
  PutSettingsRequestZ,
  type AccountSettingsPointerRecord,
  type AccountSettingsVersionRecord,
  type HistoryItem,
  type HistoryVersionDetail,
  type SettingsPointer,
  SETTINGS_BLOB_MAX_BYTES
} from '@gs-mobile-backend/core';
import { canonicalByteLength, canonicalHash, canonicalize } from '../../lib/canonical-hash.js';
import {
  getPointer,
  getVersion,
  listPointers,
  pushVersion,
  queryAllVersions,
  restorePointer,
  softDeleteVersion
} from '../../lib/settings-dynamo.js';
import { requireIdentity, type ResolvedIdentity } from '../../middleware/identity.js';

// Hono-style typed context: get hold of `identity` set by the middleware.
type SettingsContext = Context<{ Variables: { identity: ResolvedIdentity } }>;

class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', details?: unknown) {
    super(message, 403, 'forbidden', details);
    this.name = 'ForbiddenError';
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseActiveAccountId(c: Context): number {
  const raw = c.req.param('active_account_id');
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new BadRequestError(`Invalid active_account_id: ${raw}`);
  }
  return n;
}

function ensureAccessibleAccount(identity: ResolvedIdentity, activeAccountId: number): void {
  const ok = identity.accounts.some((a) => a.account_id === activeAccountId);
  if (!ok) {
    throw new ForbiddenError(
      `User has no access to active_account_id ${activeAccountId}`
    );
  }
}

function pointerWireShape(
  rec: AccountSettingsPointerRecord,
  identity: ResolvedIdentity,
  version?: AccountSettingsVersionRecord | null
): SettingsPointer {
  const name = identity.accounts.find((a) => a.account_id === rec.active_account_id)?.company ?? null;
  const out: SettingsPointer = {
    main_account_id: rec.main_account_id,
    active_account_id: rec.active_account_id,
    active_account_name: name,
    current_version_id: rec.current_version_id,
    current_version_hash: version?.settings_hash ?? '',
    updated_at: rec.updated_at,
    updated_by_user_uid: rec.updated_by_user_uid,
    updated_by_user_name: rec.updated_by_user_name,
    last_action: rec.last_action,
    last_restored_from_version_id: rec.last_restored_from_version_id
  };
  if (version) {
    out.settings_blob = JSON.parse(version.settings_blob) as Record<string, unknown>;
  }
  return out;
}

// ===========================================================================
// GET /account/settings
// ===========================================================================
export async function listAllSettings(c: SettingsContext): Promise<Response> {
  const identity = requireIdentity(c);
  const pointers = await listPointers(identity.mainAccountId);

  // We need the current version's hash for each pointer (metadata-only,
  // no blob). Batch by querying current versions in parallel.
  const items = await Promise.all(
    pointers.map(async (p) => {
      const v = await getVersion(p.main_account_id, p.active_account_id, p.current_version_id);
      return pointerWireShape(p, identity, v);
    })
  );

  return c.json({ items, next_cursor: null });
}

// ===========================================================================
// GET /account/settings/:active_account_id
// ===========================================================================
export async function getSettings(c: SettingsContext): Promise<Response> {
  const identity = requireIdentity(c);
  const activeId = parseActiveAccountId(c);
  ensureAccessibleAccount(identity, activeId);

  const pointer = await getPointer(identity.mainAccountId, activeId);
  if (!pointer) {
    throw new NotFoundError('No settings for this account pair');
  }
  const version = await getVersion(identity.mainAccountId, activeId, pointer.current_version_id);
  if (!version) {
    // Pointer exists without a version row — data inconsistency. Treat
    // as 404 from the client's perspective.
    throw new NotFoundError('Pointer is dangling (current version missing)');
  }
  return c.json(pointerWireShape(pointer, identity, version));
}

// ===========================================================================
// POST /account/settings/:active_account_id
// ===========================================================================
export async function postSettings(c: SettingsContext): Promise<Response> {
  const identity = requireIdentity(c);
  const activeId = parseActiveAccountId(c);
  ensureAccessibleAccount(identity, activeId);

  const body = await c.req.json().catch(() => null);
  const parsed = PutSettingsRequestZ.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestError('Invalid request body', parsed.error.flatten());
  }
  const blob = parsed.data.settings_blob;
  if (typeof blob !== 'object' || blob === null || Array.isArray(blob)) {
    throw new BadRequestError('settings_blob must be a JSON object');
  }

  const canonical = canonicalize(blob);
  const byteLen = canonicalByteLength(blob);
  if (byteLen > SETTINGS_BLOB_MAX_BYTES) {
    throw new AppError(
      `settings_blob too large (${byteLen} > ${SETTINGS_BLOB_MAX_BYTES})`,
      413,
      'blob_too_large',
      { max_bytes: SETTINGS_BLOB_MAX_BYTES, actual_bytes: byteLen }
    );
  }
  const hash = canonicalHash(blob);

  // No-op detection: if there's already a current pointer with the same hash,
  // do nothing and return the existing pointer.
  const existing = await getPointer(identity.mainAccountId, activeId);
  if (existing) {
    const currentVersion = await getVersion(
      identity.mainAccountId,
      activeId,
      existing.current_version_id
    );
    if (currentVersion?.settings_hash === hash) {
      return c.json(pointerWireShape(existing, identity, currentVersion));
    }
  }

  const newPointer = await pushVersion({
    mainAccountId: identity.mainAccountId,
    activeAccountId: activeId,
    settingsBlob: canonical,
    settingsHash: hash,
    userUid: identity.userUid,
    userName: identity.userName,
    now: nowIso()
  });

  const newVersion = await getVersion(
    identity.mainAccountId,
    activeId,
    newPointer.current_version_id
  );
  return c.json(pointerWireShape(newPointer, identity, newVersion));
}

// ===========================================================================
// GET /account/settings/:active_account_id/history
// ===========================================================================
export async function listHistory(c: SettingsContext): Promise<Response> {
  const identity = requireIdentity(c);
  const activeId = parseActiveAccountId(c);
  ensureAccessibleAccount(identity, activeId);

  const pointer = await getPointer(identity.mainAccountId, activeId);
  const versions = await queryAllVersions(identity.mainAccountId, activeId);
  const items: HistoryItem[] = versions
    .filter((v) => v.deleted_at === null)
    .map((v) => ({
      version_id: v.version_id,
      is_current: pointer?.current_version_id === v.version_id,
      hash: v.settings_hash,
      created_at: v.created_at,
      created_by_user_uid: v.created_by_user_uid,
      created_by_user_name: v.created_by_user_name
    }));
  return c.json({ items, next_cursor: null });
}

// ===========================================================================
// GET /account/settings/:active_account_id/history/:version_id
// ===========================================================================
export async function getHistoryVersion(c: SettingsContext): Promise<Response> {
  const identity = requireIdentity(c);
  const activeId = parseActiveAccountId(c);
  ensureAccessibleAccount(identity, activeId);
  const versionId = c.req.param('version_id')!;

  const version = await getVersion(identity.mainAccountId, activeId, versionId);
  if (!version || version.deleted_at !== null) {
    throw new NotFoundError(`Version ${versionId} not found`);
  }
  const pointer = await getPointer(identity.mainAccountId, activeId);
  const detail: HistoryVersionDetail = {
    version_id: version.version_id,
    main_account_id: version.main_account_id,
    active_account_id: version.active_account_id,
    is_current: pointer?.current_version_id === version.version_id,
    hash: version.settings_hash,
    created_at: version.created_at,
    created_by_user_uid: version.created_by_user_uid,
    created_by_user_name: version.created_by_user_name,
    settings_blob: JSON.parse(version.settings_blob)
  };
  return c.json(detail);
}

// ===========================================================================
// POST /account/settings/:active_account_id/history/:version_id/restore
// ===========================================================================
export async function restoreHistoryVersion(c: SettingsContext): Promise<Response> {
  const identity = requireIdentity(c);
  const activeId = parseActiveAccountId(c);
  ensureAccessibleAccount(identity, activeId);
  const versionId = c.req.param('version_id')!;

  const version = await getVersion(identity.mainAccountId, activeId, versionId);
  if (!version || version.deleted_at !== null) {
    throw new NotFoundError(`Version ${versionId} not found`);
  }

  const pointer = await getPointer(identity.mainAccountId, activeId);
  if (pointer?.current_version_id === versionId) {
    throw new ConflictError('Version is already current');
  }

  const newPointer = await restorePointer({
    mainAccountId: identity.mainAccountId,
    activeAccountId: activeId,
    versionId,
    userUid: identity.userUid,
    userName: identity.userName,
    now: nowIso()
  });
  return c.json(pointerWireShape(newPointer, identity, version));
}

// ===========================================================================
// DELETE /account/settings/:active_account_id/history/:version_id
// ===========================================================================
export async function deleteHistoryVersion(c: SettingsContext): Promise<Response> {
  const identity = requireIdentity(c);
  const activeId = parseActiveAccountId(c);
  ensureAccessibleAccount(identity, activeId);
  const versionId = c.req.param('version_id')!;

  const version = await getVersion(identity.mainAccountId, activeId, versionId);
  if (!version || version.deleted_at !== null) {
    throw new NotFoundError(`Version ${versionId} not found`);
  }
  const pointer = await getPointer(identity.mainAccountId, activeId);
  if (pointer?.current_version_id === versionId) {
    throw new ConflictError('Cannot delete the current version');
  }

  await softDeleteVersion({
    mainAccountId: identity.mainAccountId,
    activeAccountId: activeId,
    versionId,
    userUid: identity.userUid,
    userName: identity.userName,
    now: nowIso()
  });
  return c.json({ status: 'deleted' });
}
