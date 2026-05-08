const CACHE_KEY = 'eggButlerCache';

let db;

export async function initDB() {
  db = new Dexie('EggButlerDB');
  db.version(1).stores({
    records: '++id, type, timestamp, dateStr',
    settings: 'key'
  });
  await db.open();

  const defaultSettings = {
    key: 'preferences',
    dogName: '蛋蛋',
    breed: '边牧',
    age: 2,
    recordMode: 'simple',
    createdAt: new Date().toISOString()
  };

  const existing = await db.settings.get('preferences');
  if (!existing) {
    await db.settings.put(defaultSettings);
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
  return db.settings.get('preferences');
}

export async function saveSettings(settings) {
  await db.settings.put({ ...settings, key: 'preferences' });
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
