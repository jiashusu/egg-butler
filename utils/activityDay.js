import { formatDate, formatDateCN } from './time.js';

export function getActivityDayStarts(records = []) {
  const startsByDate = new Map();

  records
    .filter(record => record?.type === 'eat' && record.timestamp)
    .forEach(record => {
      const date = new Date(record.timestamp);
      if (Number.isNaN(date.getTime())) return;
      const key = formatDate(date);
      const existing = startsByDate.get(key);
      if (!existing || date < existing) startsByDate.set(key, date);
    });

  return [...startsByDate.entries()]
    .map(([key, start]) => ({ key, start }))
    .sort((a, b) => a.start - b.start);
}

export function getActivityDayKeyForDate(date, records = []) {
  const target = new Date(date);
  if (Number.isNaN(target.getTime())) return formatDate(new Date());

  const starts = getActivityDayStarts(records);
  let active = null;
  for (const start of starts) {
    if (start.start <= target) active = start;
    else break;
  }

  return active?.key || formatDate(target);
}

export function getActivityDayKeyForRecord(record, records = []) {
  return getActivityDayKeyForDate(new Date(record.timestamp), records);
}

export function getCurrentActivityDayKey(records = [], now = new Date()) {
  return getActivityDayKeyForDate(now, records);
}

export function getActivityDayRecords(records = [], key, sourceRecords = records) {
  return records.filter(record => getActivityDayKeyForRecord(record, sourceRecords) === key);
}

export function getRecentActivityDayBuckets(records = [], days = 7, now = new Date()) {
  const currentKey = getCurrentActivityDayKey(records, now);
  const currentDate = new Date(`${currentKey}T00:00:00`);
  const buckets = [];

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(currentDate);
    date.setDate(date.getDate() - i);
    const key = formatDate(date);
    buckets.push({
      key,
      label: formatDateCN(date),
      drink: 0,
      drinkCount: 0,
      eat: 0,
      eatCount: 0,
      poop: 0,
      pee: 0
    });
  }

  const bucketMap = new Map(buckets.map(bucket => [bucket.key, bucket]));
  records.forEach(record => {
    const key = getActivityDayKeyForRecord(record, records);
    const bucket = bucketMap.get(key);
    if (!bucket) return;
    if (record.type === 'drink') {
      bucket.drink += record.amount || 0;
      bucket.drinkCount += 1;
    } else if (record.type === 'eat') {
      bucket.eat += record.amount || 0;
      bucket.eatCount += 1;
    }
    else if (record.type === 'poop') bucket.poop += 1;
    else if (record.type === 'pee') bucket.pee += 1;
  });

  return buckets;
}

export function formatActivityDayLabel(key) {
  if (!key) return '暂无';
  return `${formatDateCN(new Date(`${key}T00:00:00`))}餐后日`;
}
