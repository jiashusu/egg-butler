const CLOUD_BACKUP_ID_KEY = 'eggButlerCloudBackupId';
const CLOUD_SYNC_META_KEY = 'eggButlerCloudSyncMeta';

export function getCloudBackupId() {
  let backupId = localStorage.getItem(CLOUD_BACKUP_ID_KEY);
  if (!isValidCloudBackupId(backupId)) {
    backupId = createCloudBackupId();
    localStorage.setItem(CLOUD_BACKUP_ID_KEY, backupId);
  }
  return backupId;
}

export function setCloudBackupId(backupId) {
  const normalized = String(backupId || '').trim();
  if (!isValidCloudBackupId(normalized)) {
    throw new Error('同步码无效');
  }
  localStorage.setItem(CLOUD_BACKUP_ID_KEY, normalized);
  return normalized;
}

export function createCloudBackupId() {
  const random = crypto.getRandomValues(new Uint8Array(24));
  return `egg_${toBase64Url(random)}`;
}

export async function uploadCloudBackup(records, backupId = getCloudBackupId(), settings = null, deletedRecordKeys = []) {
  const response = await fetch('/api/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backupId, records, settings, deletedRecordKeys, recordCount: records.length })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || '自动上传失败');
  }
  return result;
}

export async function downloadCloudBackup(backupId = getCloudBackupId()) {
  const response = await fetch(`/api/backup?backupId=${encodeURIComponent(backupId)}`);
  const result = await response.json().catch(() => ({}));

  if (response.status === 404) {
    return { records: [], exists: false };
  }
  if (!response.ok) {
    throw new Error(result.error || '自动加载失败');
  }

  return {
    exists: true,
    records: Array.isArray(result.records) ? result.records : [],
    deletedRecordKeys: Array.isArray(result.deletedRecordKeys) ? result.deletedRecordKeys : [],
    settings: result.settings || null,
    recordCount: result.recordCount || 0,
    uploadedAt: result.uploadedAt || null
  };
}

export function isValidCloudBackupId(value) {
  return typeof value === 'string' && /^egg_[A-Za-z0-9_-]{32}$/.test(value);
}

export function getCloudSyncMeta() {
  try {
    const meta = JSON.parse(localStorage.getItem(CLOUD_SYNC_META_KEY) || '{}');
    return {
      status: meta.status || 'idle',
      lastSyncAt: meta.lastSyncAt || null,
      lastUploadedAt: meta.lastUploadedAt || null,
      recordCount: Number(meta.recordCount) || 0,
      message: meta.message || ''
    };
  } catch (error) {
    return { status: 'idle', lastSyncAt: null, lastUploadedAt: null, recordCount: 0, message: '' };
  }
}

export function setCloudSyncMeta(meta = {}) {
  const next = { ...getCloudSyncMeta(), ...meta };
  localStorage.setItem(CLOUD_SYNC_META_KEY, JSON.stringify(next));
  return next;
}

function toBase64Url(bytes) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
