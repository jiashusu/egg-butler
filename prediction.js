import { minuteOfDay, getDateStr } from './utils/time.js';

const TYPE_LABELS = {
  drink: { name: '喝水', unit: 'ml', icon: '💧', default: 240 },
  eat: { name: '吃饭', unit: 'g', icon: '🍚', default: 360 },
  poop: { name: '排便', unit: '', icon: '💩', default: 480 },
  pee: { name: '尿尿', unit: '', icon: '💦', default: 180 }
};

const WEIGHTS = {
  drink: { timeOfDay: 0.25, interval: 0.40, recency: 0.35 },
  eat: { timeOfDay: 0.35, interval: 0.35, recency: 0.30 },
  poop: { timeOfDay: 0.30, interval: 0.30, recency: 0.40 },
  pee: { timeOfDay: 0.20, interval: 0.35, recency: 0.45 }
};

const POOP_STATUS = {
  normal: { label: '正常', healthScore: 1 },
  small: { label: '少量', healthScore: 0.65 },
  diarrhea: { label: '拉稀', healthScore: 0.2 },
  soft: { label: '偏软', healthScore: 0.55 },
  dry: { label: '偏干', healthScore: 0.45 }
};

function gaussianWeight(offset, sigma) {
  return Math.exp(-0.5 * (offset / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI));
}

function buildTimeOfDayDistribution(records) {
  const buckets = new Array(96).fill(0);
  const sigma = 2;

  for (const r of records) {
    const mod = minuteOfDay(new Date(r.timestamp));
    const centerBucket = Math.round(mod / 15) % 96;

    for (let offset = -3 * sigma; offset <= 3 * sigma; offset++) {
      const bucket = ((centerBucket + offset) % 96 + 96) % 96;
      buckets[bucket] += gaussianWeight(offset, sigma);
    }
  }

  const sum = buckets.reduce((a, b) => a + b, 0);
  return sum > 0 ? buckets.map(v => v / sum) : buckets;
}

function computeIntervals(records) {
  const sorted = [...records].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  if (sorted.length < 2) return [];

  const intervals = [];
  for (let i = 1; i < sorted.length; i++) {
    const interval = (new Date(sorted[i].timestamp) - new Date(sorted[i - 1].timestamp)) / 60000;
    intervals.push({ interval, index: i, timestamp: sorted[i].timestamp });
  }

  return intervals;
}

function filterOutliers(intervals) {
  if (intervals.length < 3) return intervals;

  const mean = intervals.reduce((s, x) => s + x.interval, 0) / intervals.length;
  const stdDev = Math.sqrt(intervals.reduce((s, x) => s + (x.interval - mean) ** 2, 0) / intervals.length);
  const threshold = 2 * stdDev;

  return intervals.filter(x => Math.abs(x.interval - mean) <= threshold);
}

function weightedInterval(intervals, weightRecent = true) {
  if (intervals.length === 0) return null;

  let totalWeight = 0;
  let weightedSum = 0;

  for (let i = 0; i < intervals.length; i++) {
    const weight = weightRecent ? (i + 1) / intervals.length : 1;
    weightedSum += intervals[i].interval * weight;
    totalWeight += weight;
  }

  return weightedSum / totalWeight;
}

function recencyTrend(records) {
  const sorted = [...records].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  if (sorted.length < 4) return 1.0;

  const recent = sorted.slice(-4);
  const intervals = [];
  for (let i = 1; i < recent.length; i++) {
    intervals.push((new Date(recent[i].timestamp) - new Date(recent[i - 1].timestamp)) / 60000);
  }

  const n = intervals.length;
  const sumX = n * (n - 1) / 2;
  const sumY = intervals.reduce((a, b) => a + b, 0);
  const sumXY = intervals.reduce((s, y, i) => s + i * y, 0);
  const sumX2 = intervals.reduce((s, i) => s + i * i, 0);

  if (n * sumX2 - sumX * sumX === 0) return 1.0;

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const meanInterval = sumY / n + 0.001;

  const trendFactor = 1 + (slope / meanInterval) * 0.5;
  return Math.max(0.8, Math.min(1.2, trendFactor));
}

function estimateConfidence(intervals, totalRecords) {
  if (intervals.length === 0) return 0.1;
  if (intervals.length === 1) return 0.15;

  const mean = intervals.reduce((s, x) => s + x.interval, 0) / intervals.length;
  const stdDev = Math.sqrt(intervals.reduce((s, x) => s + (x.interval - mean) ** 2, 0) / intervals.length);
  const cv = Math.min(2, stdDev / (mean + 0.001));

  const stability = Math.max(0, 1 - cv * 0.6);
  const dataVolume = Math.min(1, totalRecords / 20);

  return Math.max(0.1, Math.min(0.95, stability * (0.3 + 0.7 * dataVolume)));
}

export function predictNext(type, records) {
  const typedRecords = records.filter(r => r.type === type);
  const totalRecords = typedRecords.length;

  if (totalRecords === 0) {
    return {
      type,
      nextTime: null,
      confidence: 0,
      message: '暂无数据',
      todayCount: 0,
      avgInterval: null
    };
  }

  const today = getDateStr(new Date());
  const todayCount = typedRecords.filter(r => r.dateStr === today).length;

  const lastRecord = typedRecords[typedRecords.length - 1];
  const lastTime = new Date(lastRecord.timestamp);
  const now = new Date();

  if (totalRecords === 1) {
    const defaultMin = TYPE_LABELS[type].default;
    const next = new Date(lastTime.getTime() + defaultMin * 60000);

    const timeSinceLast = (now - lastTime) / 60000;
    const overdue = timeSinceLast > defaultMin * 2;
    const status = type === 'poop' ? normalizePoopStatus(lastRecord.value) : null;

    return {
      type,
      nextTime: next,
      confidence: status && status !== 'normal' ? 0.12 : 0.2,
      message: status && status !== 'normal'
        ? `最近${POOP_STATUS[status].label}，注意观察`
        : (overdue ? `该${TYPE_LABELS[type].name}了！` : '数据较少，仅供参考'),
      todayCount,
      avgInterval: null
    };
  }

  const allIntervals = computeIntervals(typedRecords);
  const filteredIntervals = filterOutliers(allIntervals);
  const avgInterval = weightedInterval(filteredIntervals, true);

  if (!avgInterval) {
    return {
      type,
      nextTime: null,
      confidence: 0.1,
      message: '预测不可用',
      todayCount,
      avgInterval: null
    };
  }

  const trend = recencyTrend(typedRecords);
  const adjustedInterval = avgInterval * trend;

  const intervalBasedTime = new Date(lastTime.getTime() + adjustedInterval * 60000);

  const tod = buildTimeOfDayDistribution(typedRecords);

  const searchStart = new Date(Math.min(now, lastTime.getTime()));
  const searchEnd = new Date(lastTime.getTime() + 2 * adjustedInterval * 60000);

  let bestSlot = null;
  let bestScore = -Infinity;
  const granularity = 15;

  const cursor = new Date(searchStart);
  while (cursor <= searchEnd) {
    const mod = cursor.getHours() * 60 + cursor.getMinutes();
    const bucketIndex = Math.round(mod / 15) % 96;

    const todScore = tod[bucketIndex] || 0;

    const diffFromInterval = Math.abs(cursor - intervalBasedTime) / 60000;
    const intervalSigma = Math.max(30, adjustedInterval * 0.25);
    const intervalScore = gaussianWeight(diffFromInterval, intervalSigma);

    const w = WEIGHTS[type];
    const score = w.timeOfDay * todScore + w.interval * intervalScore + w.recency * intervalScore;

    if (score > bestScore) {
      bestScore = score;
      bestSlot = new Date(cursor);
    }
    cursor.setTime(cursor.getTime() + granularity * 60000);
  }

  let confidence = parseFloat(estimateConfidence(filteredIntervals, totalRecords).toFixed(2));

  let message;
  if (totalRecords < 3) {
    message = '刚开始记录，多记几次更准';
  } else if (confidence > 0.7) {
    message = '预测可靠 ✓';
  } else if (confidence > 0.4) {
    message = '预测一般';
  } else {
    message = '数据较少，仅供参考';
  }

  const timeSinceLast = (now - lastTime) / 60000;
  if (timeSinceLast > adjustedInterval * 1.3 && totalRecords > 1) {
    message = `该${TYPE_LABELS[type].label || TYPE_LABELS[type].name}了！`;
  }

  if (type === 'poop') {
    const health = getPoopHealthSummary(typedRecords);
    if (health.recentAbnormalCount > 0) {
      confidence = parseFloat(Math.max(0.1, confidence * health.healthFactor).toFixed(2));
      message = health.lastStatus === 'diarrhea'
        ? '最近拉稀，注意观察'
        : `最近${POOP_STATUS[health.lastStatus]?.label || '排便异常'}，注意观察`;
    }
  }

  return {
    type,
    nextTime: bestSlot,
    confidence,
    intervalMinutes: Math.round(adjustedInterval),
    message,
    todayCount,
    avgInterval: Math.round(avgInterval),
    totalRecords
  };
}

export function predictAll(records) {
  const types = ['drink', 'eat', 'poop', 'pee'];
  const results = {};
  for (const type of types) {
    results[type] = predictNext(type, records);
  }
  return results;
}

export function getStats(type, records) {
  const typedRecords = records.filter(r => r.type === type);

  if (typedRecords.length === 0) {
    return {
      type,
      totalRecords: 0,
      avgInterval: null,
      todayCount: 0,
      totalToday: 0
    };
  }

  const today = getDateStr(new Date());
  const todayRecords = typedRecords.filter(r => r.dateStr === today);

  let totalToday = 0;
  if (type === 'drink' || type === 'eat') {
    totalToday = todayRecords.reduce((sum, r) => sum + (r.amount || 0), 0);
  }

  const poopStats = type === 'poop' ? getPoopStats(typedRecords, todayRecords) : {};

  const intervals = computeIntervals(typedRecords);
  const filtered = filterOutliers(intervals);
  const avgInterval = filtered.length > 0 ? Math.round(weightedInterval(filtered, false)) : null;

  return {
    type,
    totalRecords: typedRecords.length,
    avgInterval,
    todayCount: todayRecords.length,
    totalToday,
    todayRecords,
    ...poopStats
  };
}

function getPoopStats(records, todayRecords) {
  const breakdown = {};
  for (const key of Object.keys(POOP_STATUS)) {
    breakdown[key] = 0;
  }

  for (const record of records) {
    const status = normalizePoopStatus(record.value);
    breakdown[status]++;
  }

  const abnormalToday = todayRecords
    .filter(record => normalizePoopStatus(record.value) !== 'normal')
    .length;
  const normalCount = breakdown.normal || 0;
  const normalRate = records.length > 0 ? normalCount / records.length : 0;
  const recent = records
    .slice()
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 5);
  const recentAbnormalCount = recent
    .filter(record => normalizePoopStatus(record.value) !== 'normal')
    .length;

  return {
    poopBreakdown: breakdown,
    poopNormalRate: normalRate,
    poopAbnormalToday: abnormalToday,
    poopRecentAbnormalCount: recentAbnormalCount
  };
}

function getPoopHealthSummary(records) {
  const recent = records
    .slice()
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 3);
  const lastStatus = normalizePoopStatus(recent[0]?.value);
  const recentAbnormalCount = recent
    .filter(record => normalizePoopStatus(record.value) !== 'normal')
    .length;
  const avgHealth = recent.length > 0
    ? recent.reduce((sum, record) => sum + POOP_STATUS[normalizePoopStatus(record.value)].healthScore, 0) / recent.length
    : 1;

  return {
    lastStatus,
    recentAbnormalCount,
    healthFactor: Math.max(0.45, avgHealth)
  };
}

function normalizePoopStatus(value) {
  return POOP_STATUS[value] ? value : 'normal';
}
