import { list, put } from '@vercel/blob';

const BACKUP_PREFIX = 'egg-butler-backups';
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

export default async function handler(req, res) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return sendJSON(res, 503, { error: '云端同步存储还没有配置好' });
  }

  try {
    if (req.method === 'GET') {
      return getBackup(req, res);
    }

    if (req.method === 'POST') {
      return saveBackup(req, res);
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

  const { blobs } = await list({ prefix: `${BACKUP_PREFIX}/${backupId}/`, limit: 100 });
  const blob = blobs
    .filter((item) => item.pathname.endsWith('.json'))
    .sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0))[0];

  if (!blob) {
    return sendJSON(res, 404, { error: '没有找到这个备份' });
  }

  const response = await fetch(blob.url, { cache: 'no-store' });
  if (!response.ok) {
    return sendJSON(res, 502, { error: '读取云端同步数据失败' });
  }

  const body = await response.json();
  return sendJSON(res, 200, {
    records: Array.isArray(body.records) ? body.records : [],
    deletedRecordKeys: Array.isArray(body.deletedRecordKeys) ? body.deletedRecordKeys : [],
    settings: body.settings || null,
    recordCount: body.recordCount || 0,
    uploadedAt: body.uploadedAt || null
  });
}

async function saveBackup(req, res) {
  const { backupId, records, settings, deletedRecordKeys, recordCount } = req.body || {};
  if (!isValidBackupId(backupId)) {
    return sendJSON(res, 400, { error: '同步码无效' });
  }
  if (!Array.isArray(records)) {
    return sendJSON(res, 400, { error: '备份内容无效' });
  }

  const body = {
    version: 2,
    uploadedAt: new Date().toISOString(),
    recordCount: Number(recordCount) || 0,
    records,
    deletedRecordKeys: normalizeDeletedRecordKeys(deletedRecordKeys),
    settings: settings && typeof settings === 'object' ? settings : null
  };
  const serialized = JSON.stringify(body);
  if (new TextEncoder().encode(serialized).length > MAX_PAYLOAD_BYTES) {
    return sendJSON(res, 413, { error: '备份太大，暂时无法上传' });
  }

  const pathname = `${BACKUP_PREFIX}/${backupId}/${Date.now()}.json`;
  await put(pathname, serialized, {
    access: 'public',
    contentType: 'application/json',
    cacheControlMaxAge: 31536000
  });

  return sendJSON(res, 200, {
    ok: true,
    uploadedAt: body.uploadedAt,
    recordCount: body.recordCount
  });
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
  return keys
    .filter(key => typeof key === 'string' && key.includes('|'))
    .slice(-3000);
}
