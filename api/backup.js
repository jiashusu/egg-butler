import { list, put } from '@vercel/blob';

const BACKUP_PREFIX = 'egg-butler-backups';
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;
const LATEST_BACKUP_FILE = 'latest.json';

export default async function handler(req, res) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return sendJSON(res, 503, { error: '云端同步存储还没有配置好' });
  }

  try {
    if (req.method === 'GET') {
      return await getBackup(req, res);
    }

    if (req.method === 'POST') {
      return await saveBackup(req, res);
    }

    res.setHeader('Allow', 'GET, POST');
    return sendJSON(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    console.error('Backup API failed:', error);
    return sendJSON(res, 500, { error: '云端同步服务暂时不可用' });
  }
}

async function getBackup(req, res) {
  const backupId = String(req.query.backupId || '');
  if (!isValidBackupId(backupId)) {
    return sendJSON(res, 400, { error: '同步码无效' });
  }

  const backup = await loadCanonicalBackup(backupId);
  if (!backup) {
    return sendJSON(res, 404, { error: '没有找到这个备份' });
  }

  return sendJSON(res, 200, backup);
}

async function saveBackup(req, res) {
  const { backupId, records, settings, deletedRecordKeys, recordCount } = req.body || {};
  if (!isValidBackupId(backupId)) {
    return sendJSON(res, 400, { error: '同步码无效' });
  }
  if (!Array.isArray(records)) {
    return sendJSON(res, 400, { error: '备份内容无效' });
  }

  const existing = await loadCanonicalBackup(backupId);
  const body = mergeBackups([
    existing,
    {
      uploadedAt: new Date().toISOString(),
      recordCount,
      records,
      deletedRecordKeys,
      settings
    }
  ]);
  const next = {
    ...body,
    version: 3,
    uploadedAt: new Date().toISOString(),
    recordCount: body.records.length
  };
  const serialized = JSON.stringify(next);
  if (new TextEncoder().encode(serialized).length > MAX_PAYLOAD_BYTES) {
    return sendJSON(res, 413, { error: '备份太大，暂时无法上传' });
  }

  const pathname = `${BACKUP_PREFIX}/${backupId}/${LATEST_BACKUP_FILE}`;
  await put(pathname, serialized, {
    access: 'public',
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 60
  });

  return sendJSON(res, 200, {
    ok: true,
    ...next
  });
}

async function loadCanonicalBackup(backupId) {
  const blobs = await listBackupBlobs(backupId);
  if (blobs.length === 0) return null;

  const latestBlob = blobs.find((blob) => blob.pathname.endsWith(`/${LATEST_BACKUP_FILE}`));
  if (latestBlob) {
    return mergeBackups([await fetchBackupBody(latestBlob)]);
  }

  const backups = await fetchBackupBodies(blobs);

  return recoverBackupFromHistory(backups);
}

async function listBackupBlobs(backupId) {
  const prefix = `${BACKUP_PREFIX}/${backupId}/`;
  const blobs = [];
  let cursor;

  do {
    const page = await list({ prefix, limit: 1000, cursor });
    blobs.push(...page.blobs.filter((item) => item.pathname.endsWith('.json')));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return blobs.sort((a, b) => new Date(a.uploadedAt || 0) - new Date(b.uploadedAt || 0));
}

async function fetchBackupBody(blob) {
  // A fixed version query can keep serving a cached overwritten latest.json.
  const cacheBust = `${Date.now()}-${crypto.randomUUID()}`;
  const response = await fetch(`${blob.url}?v=${cacheBust}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Backup storage read failed (${response.status})`);
  const body = await response.json();
  return {
    records: Array.isArray(body.records) ? body.records : [],
    deletedRecordKeys: normalizeDeletedRecordKeys(body.deletedRecordKeys),
    settings: body.settings || null,
    recordCount: body.recordCount || 0,
    uploadedAt: body.uploadedAt || blob.uploadedAt || null
  };
}

async function fetchBackupBodies(blobs) {
  const bodies = await Promise.all(
    blobs.map((blob) => fetchBackupBody(blob).catch(() => null))
  );
  return bodies.filter(Boolean);
}

function mergeBackups(backups) {
  const cleanBackups = backups.filter(Boolean);
  const deletedRecordKeys = normalizeDeletedRecordKeys(
    cleanBackups.flatMap((backup) => backup.deletedRecordKeys || [])
  );
  const deletedSet = new Set(deletedRecordKeys);
  const recordMap = new Map();

  for (const backup of cleanBackups) {
    for (const item of backup.records || []) {
      const record = normalizeRecord(item);
      if (!record) continue;
      const key = recordKey(record);
      if (deletedSet.has(key)) continue;
      recordMap.set(key, record);
    }
  }

  const records = Array.from(recordMap.values())
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  return {
    records,
    deletedRecordKeys,
    settings: pickLatestSettings(cleanBackups),
    recordCount: records.length,
    uploadedAt: latestUploadedAt(cleanBackups)
  };
}

function recoverBackupFromHistory(backups) {
  const cleanBackups = backups.filter(Boolean);
  if (cleanBackups.length === 0) return null;

  const deletedRecordKeys = normalizeDeletedRecordKeys(
    cleanBackups.flatMap((backup) => backup.deletedRecordKeys || [])
  );
  const deletedSet = new Set(deletedRecordKeys);
  const base = cleanBackups.slice().sort(compareBackupFreshness).at(-1);
  const recordMap = new Map();

  for (const item of base.records || []) {
    const record = normalizeRecord(item);
    if (!record) continue;
    const key = recordKey(record);
    if (deletedSet.has(key)) continue;
    recordMap.set(key, record);
  }

  const records = Array.from(recordMap.values())
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  return {
    records,
    deletedRecordKeys,
    settings: pickLatestSettings(cleanBackups),
    recordCount: records.length,
    uploadedAt: base.uploadedAt || latestUploadedAt(cleanBackups)
  };
}

function compareBackupFreshness(a, b) {
  const recordTimeDiff = maxRecordTime(a) - maxRecordTime(b);
  if (recordTimeDiff !== 0) return recordTimeDiff;

  const countDiff = (Number(a.recordCount) || a.records?.length || 0) - (Number(b.recordCount) || b.records?.length || 0);
  if (countDiff !== 0) return countDiff;

  return new Date(a.uploadedAt || 0) - new Date(b.uploadedAt || 0);
}

function maxRecordTime(backup) {
  return (backup.records || []).reduce((max, record) => {
    const time = new Date(record?.timestamp || 0).getTime();
    return Number.isFinite(time) && time > max ? time : max;
  }, 0);
}

function normalizeRecord(item) {
  if (!item || !item.type || !item.timestamp) return null;
  const date = new Date(item.timestamp);
  if (Number.isNaN(date.getTime())) return null;

  const record = {
    type: item.type,
    timestamp: date.toISOString(),
    dateStr: item.dateStr || `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  };

  if (item.amount !== undefined && item.amount !== null) {
    const amount = Number(item.amount);
    if (Number.isFinite(amount)) record.amount = amount;
  }
  if (item.value !== undefined && item.value !== null) record.value = item.value;

  return record;
}

function recordKey(record) {
  return [
    record.type,
    record.timestamp,
    record.amount ?? '',
    record.value ?? ''
  ].join('|');
}

function pickLatestSettings(backups) {
  const settingsBackups = backups.filter((backup) => backup.settings && typeof backup.settings === 'object');
  if (settingsBackups.length === 0) return null;

  return settingsBackups
    .sort((a, b) => backupSettingsTime(a) - backupSettingsTime(b))
    .at(-1).settings;
}

function backupSettingsTime(backup) {
  const updatedAt = backup.settings?.updatedAt || backup.uploadedAt;
  const time = new Date(updatedAt || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function latestUploadedAt(backups) {
  const time = backups
    .map((backup) => new Date(backup.uploadedAt || 0).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];

  return time ? new Date(time).toISOString() : null;
}

function sendJSON(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function isValidBackupId(value) {
  return typeof value === 'string' && /^egg_[A-Za-z0-9_-]{32}$/.test(value);
}

function normalizeDeletedRecordKeys(keys) {
  if (!Array.isArray(keys)) return [];
  return Array.from(new Set(keys
    .filter(key => typeof key === 'string' && key.includes('|'))
  )).slice(-3000);
}
