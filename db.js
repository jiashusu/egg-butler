const CACHE_KEY = 'eggButlerCache';
const DELETED_RECORD_KEYS_KEY = 'eggButlerDeletedRecordKeys';
const MAX_DELETED_RECORD_KEYS = 3000;

let db;

export const DEFAULT_PET_PHOTO = '/assets/dandan-cover-20261012.jpg';

const DEFAULT_SETTINGS = {
  key: 'preferences',
  petName: '蛋蛋',
  dogName: '蛋蛋',
  species: '狗狗',
  breed: '边牧',
  age: 2,
  photoUrl: DEFAULT_PET_PHOTO,
  drinkGoal: 607,
  mealDefault: 465,
  drinkDefaultAmount: 607,
  mealDefaultAmount: 465,
  drinkGoalCount: 3,
  mealGoalCount: 1,
  recordMode: 'simple',
  createdAt: new Date().toISOString()
};

export async function initDB() {
  db = new Dexie('EggButlerDB');
  db.version(1).stores({
    records: '++id, type, timestamp, dateStr',
    settings: 'key'
  });
  await db.open();

  const existing = await db.settings.get('preferences');
  if (!existing) {
    await db.settings.put(DEFAULT_SETTINGS);
  } else if (!existing.petName) {
    await saveSettings({ ...DEFAULT_SETTINGS, ...existing, petName: existing.dogName || DEFAULT_SETTINGS.petName });
  }

  return db;
}

export async function addRecord(type, amount = null, value = null, timestamp = null) {
  const ts = timestamp || new Date().toISOString();
  const date = new Date(ts);
  const record = {
    type,
    timestamp: ts,
    dateStr: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  };

  if (amount !== null) record.amount = amount;
  if (value !== null) record.value = value;

  const id = await db.records.add(record);
  invalidateCache();
  return { ...record, id };
}

export async function getRecords(type = null, startDate = null, endDate = null) {
  let collection = db.records.orderBy('timestamp');

  if (type) {
    collection = collection.filter(r => r.type === type);
  }
  if (startDate) {
    const start = new Date(startDate).toISOString();
    collection = collection.filter(r => r.timestamp >= start);
  }
  if (endDate) {
    const end = new Date(endDate).toISOString();
    collection = collection.filter(r => r.timestamp <= end);
  }

  return collection.toArray();
}

export async function getAllRecords() {
  const cached = loadCache();
  if (cached) return cached;

  const records = await db.records.orderBy('timestamp').toArray();
  saveCache(records);
  return records;
}

export async function getRecordsByType(type) {
  return db.records.where('type').equals(type).sortBy('timestamp');
}

export async function getRecordsByDate(dateStr) {
  return db.records.where('dateStr').equals(dateStr).toArray();
}

export async function getTodayRecords() {
  const now = new Date();
  const ds = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return getRecordsByDate(ds);
}

export async function deleteRecord(id) {
  const record = await db.records.get(id);
  if (record) rememberDeletedRecordKeys([recordKey(record)]);
  await db.records.delete(id);
  invalidateCache();
}

export async function updateRecord(id, updates = {}) {
  const current = await db.records.get(id);
  if (!current) throw new Error('记录不存在');

  const timestamp = updates.timestamp || current.timestamp;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) throw new Error('时间无效');

  const next = {
    ...current,
    ...updates,
    timestamp: date.toISOString(),
    dateStr: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  };

  if (next.amount === '' || next.amount === undefined || next.amount === null) delete next.amount;
  if (next.value === '' || next.value === undefined || next.value === null) delete next.value;

  const currentKey = recordKey(current);
  const nextKey = recordKey(next);
  if (currentKey !== nextKey) rememberDeletedRecordKeys([currentKey]);

  await db.records.put(next);
  invalidateCache();
  return next;
}

export async function addRecords(records = []) {
  const cleanRecords = [];
  for (const item of records) {
    if (!item || !item.type || !item.timestamp) continue;
    const date = new Date(item.timestamp);
    if (Number.isNaN(date.getTime())) continue;
    const record = {
      type: item.type,
      timestamp: date.toISOString(),
      dateStr: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    };
    if (item.amount !== undefined && item.amount !== null && item.amount !== '') {
      const amount = Number(item.amount);
      if (Number.isFinite(amount)) record.amount = amount;
    }
    if (item.value !== undefined && item.value !== null && item.value !== '') record.value = item.value;
    cleanRecords.push(record);
  }

  if (cleanRecords.length > 0) {
    await db.records.bulkAdd(cleanRecords);
    invalidateCache();
  }

  return cleanRecords.length;
}

export async function importRecords(incomingRecords = []) {
  const existing = await db.records.toArray();
  const seen = new Set(existing.map(recordKey));
  const recordsToAdd = [];

  for (const item of incomingRecords) {
    if (!item || !item.type || !item.timestamp) continue;
    const date = new Date(item.timestamp);
    if (Number.isNaN(date.getTime())) continue;

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

    const key = recordKey(record);
    if (isDeletedRecordKey(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    recordsToAdd.push(record);
  }

  if (recordsToAdd.length > 0) {
    await db.records.bulkAdd(recordsToAdd);
    invalidateCache();
  }

  return {
    imported: recordsToAdd.length,
    skipped: incomingRecords.length - recordsToAdd.length
  };
}

export async function getSettings() {
  const settings = await db.settings.get('preferences');
  return normalizeSettings(settings);
}

export async function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  await db.settings.put({ ...normalized, key: 'preferences', updatedAt: new Date().toISOString() });
  return normalized;
}

export async function importSettings(settings) {
  if (!settings || typeof settings !== 'object') return getSettings();
  const current = await getSettings();
  const remoteTime = Date.parse(settings.updatedAt || settings.createdAt) || 0;
  const localTime = Date.parse(current.updatedAt || current.createdAt) || 0;
  if (current.updatedAt && remoteTime < localTime) return current;
  const next = normalizeSettings({ ...current, ...settings });
  // Downloading a profile is not an edit: preserve its original revision time.
  await db.settings.put({ ...next, key: 'preferences' });
  return next;
}

export async function getRecordCount() {
  return db.records.count();
}

export async function clearAllData() {
  const records = await db.records.toArray();
  rememberDeletedRecordKeys(records.map(recordKey));
  await db.records.clear();
  invalidateCache();
}

export function getDeletedRecordKeys() {
  return loadDeletedRecordKeys();
}

export async function applyDeletedRecordKeys(keys = []) {
  const cleanKeys = normalizeDeletedRecordKeys(keys);
  if (cleanKeys.length === 0) return { imported: 0, deleted: 0 };

  const beforeCount = loadDeletedRecordKeys().length;
  rememberDeletedRecordKeys(cleanKeys);
  const afterCount = loadDeletedRecordKeys().length;

  const deletedKeySet = new Set(cleanKeys);
  const records = await db.records.toArray();
  const idsToDelete = records
    .filter(record => deletedKeySet.has(recordKey(record)))
    .map(record => record.id);

  if (idsToDelete.length > 0) {
    await db.records.bulkDelete(idsToDelete);
    invalidateCache();
  }

  return {
    imported: Math.max(0, afterCount - beforeCount),
    deleted: idsToDelete.length
  };
}

function loadCache() {
  try {
    const data = localStorage.getItem(CACHE_KEY);
    if (data) {
      const { records, timestamp } = JSON.parse(data);
      if (Date.now() - timestamp < 5000) return records;
    }
  } catch (e) {}
  return null;
}

function saveCache(records) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      records,
      timestamp: Date.now()
    }));
  } catch (e) {}
}

function invalidateCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch (e) {}
}

function loadDeletedRecordKeys() {
  try {
    const keys = JSON.parse(localStorage.getItem(DELETED_RECORD_KEYS_KEY) || '[]');
    return normalizeDeletedRecordKeys(keys);
  } catch (e) {
    return [];
  }
}

function saveDeletedRecordKeys(keys) {
  try {
    localStorage.setItem(DELETED_RECORD_KEYS_KEY, JSON.stringify(keys));
  } catch (e) {}
}

function rememberDeletedRecordKeys(keys) {
  const merged = new Set(loadDeletedRecordKeys());
  for (const key of normalizeDeletedRecordKeys(keys)) {
    merged.add(key);
  }

  const next = Array.from(merged).slice(-MAX_DELETED_RECORD_KEYS);
  saveDeletedRecordKeys(next);
  return next;
}

function isDeletedRecordKey(key) {
  return loadDeletedRecordKeys().includes(key);
}

function normalizeDeletedRecordKeys(keys) {
  if (!Array.isArray(keys)) return [];
  return keys
    .filter(key => typeof key === 'string' && key.includes('|'))
    .slice(-MAX_DELETED_RECORD_KEYS);
}

function recordKey(record) {
  return [
    record.type,
    record.timestamp,
    record.amount ?? '',
    record.value ?? ''
  ].join('|');
}

function normalizeSettings(settings = {}) {
  const petName = settings.petName || settings.dogName || DEFAULT_SETTINGS.petName;
  const drinkDefaultAmount = toPositiveNumber(settings.drinkDefaultAmount ?? settings.drinkGoal, DEFAULT_SETTINGS.drinkDefaultAmount);
  const mealDefaultAmount = toPositiveNumber(settings.mealDefaultAmount ?? settings.mealDefault, DEFAULT_SETTINGS.mealDefaultAmount);
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    petName,
    dogName: petName,
    species: settings.species || DEFAULT_SETTINGS.species,
    breed: settings.breed || DEFAULT_SETTINGS.breed,
    age: settings.age ?? DEFAULT_SETTINGS.age,
    photoUrl: !settings.photoUrl || settings.photoUrl === '/assets/dandan-portrait.jpeg'
      ? DEFAULT_PET_PHOTO
      : settings.photoUrl,
    drinkGoal: drinkDefaultAmount,
    mealDefault: mealDefaultAmount,
    drinkDefaultAmount,
    mealDefaultAmount,
    drinkGoalCount: toPositiveInteger(settings.drinkGoalCount, DEFAULT_SETTINGS.drinkGoalCount),
    mealGoalCount: toPositiveInteger(settings.mealGoalCount, DEFAULT_SETTINGS.mealGoalCount)
  };
}

function toPositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function toPositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
}
