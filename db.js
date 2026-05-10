const CACHE_KEY = 'eggButlerCache';

let db;

const DEFAULT_SETTINGS = {
  key: 'preferences',
  petName: '蛋蛋',
  dogName: '蛋蛋',
  species: '狗狗',
  breed: '边牧',
  age: 2,
  photoUrl: '/assets/dandan-portrait.jpeg',
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
  return saveSettings({ ...(await getSettings()), ...settings });
}

export async function getRecordCount() {
  return db.records.count();
}

export async function clearAllData() {
  await db.records.clear();
  invalidateCache();
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
    photoUrl: settings.photoUrl || DEFAULT_SETTINGS.photoUrl,
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
