import { minuteOfDay } from './utils/time.js';
import { getActivityDayKeyForRecord, getActivityDayRecords, getCurrentActivityDayKey } from './utils/activityDay.js';

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

const MIN_INTERVAL_FACTOR = {
  drink: 0.35,
  eat: 0.45,
  poop: 0.55,
  pee: 0.55
};

const MIN_INTERVAL_MINUTES = {
  drink: 90,
  eat: 360,
  poop: 180,
  pee: 180
};

const RELATION_WINDOWS = {
  feedPair: 15,
  drinkToPee: 360,
  peeToPoop: 45,
  eatToPoop: 720
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

function normalizedGaussianScore(offset, sigma) {
  return Math.exp(-0.5 * (offset / sigma) ** 2);
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

  const values = intervals.map(x => x.interval).sort((a, b) => a - b);
  const q1 = percentile(values, 0.25);
  const q3 = percentile(values, 0.75);
  const iqr = q3 - q1;

  if (iqr <= 0) return intervals;

  const min = q1 - iqr * 1.5;
  const max = q3 + iqr * 1.5;
  const filtered = intervals.filter(x => x.interval >= min && x.interval <= max);
  return filtered.length > 0 ? filtered : intervals;
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

function sortByTime(records = []) {
  return records
    .filter(record => record?.timestamp && !Number.isNaN(new Date(record.timestamp).getTime()))
    .slice()
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function latestOfType(records, type) {
  const typed = sortByTime(records).filter(record => record.type === type);
  return typed[typed.length - 1] || null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(sortedValues, ratio) {
  if (!sortedValues.length) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const index = (sortedValues.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (index - lower);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function blendDates(a, b, bWeight) {
  if (!a) return b;
  if (!b) return a;
  const weight = clamp(bWeight, 0, 1);
  return new Date(a.getTime() * (1 - weight) + b.getTime() * weight);
}

function computeIntervalProfile(records) {
  const intervals = computeIntervals(records);
  const filtered = filterOutliers(intervals);
  const values = filtered.map(item => item.interval);
  const med = median(values);
  const weighted = weightedInterval(filtered, true);
  const stableInterval = med && weighted
    ? med * 0.65 + weighted * 0.35
    : weighted || med || null;

  return {
    intervals,
    filtered,
    median: med,
    weighted,
    stableInterval
  };
}

function summarizeForwardRelation(records, sourceType, targetType, maxMinutes, label) {
  const sorted = sortByTime(records);
  const intervals = [];
  const usedTargets = new Set();

  sorted.forEach((source, sourceIndex) => {
    if (source.type !== sourceType) return;
    const sourceTime = new Date(source.timestamp);
    const targetIndex = sorted.findIndex((target, index) => {
      if (index <= sourceIndex || usedTargets.has(index) || target.type !== targetType) return false;
      const minutes = (new Date(target.timestamp) - sourceTime) / 60000;
      return minutes >= 0 && minutes <= maxMinutes;
    });

    if (targetIndex >= 0) {
      usedTargets.add(targetIndex);
      intervals.push((new Date(sorted[targetIndex].timestamp) - sourceTime) / 60000);
    }
  });

  return summarizeRelationIntervals(intervals, label, sourceType, targetType, maxMinutes);
}

function summarizeNearPair(records, aType, bType, maxAbsMinutes, label) {
  const sorted = sortByTime(records);
  const intervals = [];
  const usedTargets = new Set();

  sorted.forEach((source) => {
    if (source.type !== aType) return;
    const sourceTime = new Date(source.timestamp);
    let best = null;

    sorted.forEach((target, targetIndex) => {
      if (target.type !== bType || usedTargets.has(targetIndex)) return;
      const minutes = (new Date(target.timestamp) - sourceTime) / 60000;
      if (Math.abs(minutes) > maxAbsMinutes) return;
      if (!best || Math.abs(minutes) < Math.abs(best.minutes)) {
        best = { targetIndex, minutes };
      }
    });

    if (best) {
      usedTargets.add(best.targetIndex);
      intervals.push(best.minutes);
    }
  });

  return summarizeRelationIntervals(intervals, label, aType, bType, maxAbsMinutes);
}

function summarizeRelationIntervals(intervals, label, sourceType, targetType, maxMinutes) {
  const sorted = intervals.slice().sort((a, b) => a - b);
  const absSorted = intervals.map(Math.abs).sort((a, b) => a - b);
  const avg = intervals.length > 0
    ? intervals.reduce((sum, minutes) => sum + minutes, 0) / intervals.length
    : 0;

  return {
    label,
    sourceType,
    targetType,
    maxMinutes,
    samples: intervals.length,
    avg: Math.round(avg),
    median: sorted.length ? median(sorted) : null,
    p75: absSorted.length ? percentile(absSorted, 0.75) : null,
    intervals: sorted
  };
}

export function analyzeRhythmRelations(records = []) {
  return {
    feedPair: summarizeNearPair(records, 'eat', 'drink', RELATION_WINDOWS.feedPair, '吃饭和喝水同轮'),
    drinkToPee: summarizeForwardRelation(records, 'drink', 'pee', RELATION_WINDOWS.drinkToPee, '喝水后尿尿'),
    peeToPoop: summarizeForwardRelation(records, 'pee', 'poop', RELATION_WINDOWS.peeToPoop, '尿尿后排便'),
    eatToPoop: summarizeForwardRelation(records, 'eat', 'poop', RELATION_WINDOWS.eatToPoop, '吃饭后排便')
  };
}

function hasNearRecord(records, type, date, maxAbsMinutes) {
  const targetTime = date.getTime();
  return records.some(record => {
    if (record.type !== type || !record.timestamp) return false;
    const minutes = Math.abs((new Date(record.timestamp).getTime() - targetTime) / 60000);
    return minutes <= maxAbsMinutes;
  });
}

function hasTargetAfter(sourceRecord, records, targetType, maxMinutes) {
  if (!sourceRecord) return false;
  const sourceTime = new Date(sourceRecord.timestamp);
  return records.some(record => {
    if (record.type !== targetType || !record.timestamp) return false;
    const minutes = (new Date(record.timestamp) - sourceTime) / 60000;
    return minutes >= 0 && minutes <= maxMinutes;
  });
}

function relationConfidenceBoost(relation) {
  if (!relation?.samples) return 0;
  return Math.min(0.18, relation.samples * 0.025);
}

function applyRelationAdjustments({ type, records, typedRecords, nextTime, confidence, message, adjustedInterval, now, relations }) {
  let resultTime = nextTime;
  let resultConfidence = confidence;
  let resultMessage = message;

  if (type === 'drink' || type === 'eat') {
    const otherType = type === 'drink' ? 'eat' : 'drink';
    const otherLatest = latestOfType(records, otherType);
    const currentLatest = typedRecords[typedRecords.length - 1] || null;
    const pair = relations.feedPair;

    if (otherLatest && pair.samples >= 2) {
      const otherTime = new Date(otherLatest.timestamp);
      const alreadyPaired = hasNearRecord(records, type, otherTime, RELATION_WINDOWS.feedPair);
      const currentAfterOther = currentLatest && new Date(currentLatest.timestamp) >= otherTime;
      const minutesSinceOther = (now - otherTime) / 60000;

      if (!alreadyPaired && !currentAfterOther && minutesSinceOther >= 0 && minutesSinceOther <= 120) {
        const learnedOffset = type === 'drink' ? pair.median : -pair.median;
        const pairTime = new Date(otherTime.getTime() + learnedOffset * 60000);
        resultTime = pairTime <= now ? new Date(now) : pairTime;
        resultConfidence = Math.min(0.9, resultConfidence + relationConfidenceBoost(pair));
        resultMessage = resultTime <= now ? `该${TYPE_LABELS[type].name}啦` : '这一轮通常会一起记录';
      }
    }
  }

  if (type === 'poop') {
    const peeToPoop = relations.peeToPoop;
    const latestPee = latestOfType(records, 'pee');
    const latestPoop = latestOfType(records, 'poop');

    if (latestPee && peeToPoop.samples >= 3) {
      const peeTime = new Date(latestPee.timestamp);
      const poopAfterPee = latestPoop && new Date(latestPoop.timestamp) >= peeTime;
      const minutesSincePee = (now - peeTime) / 60000;
      const pairDelay = clamp(peeToPoop.median ?? peeToPoop.avg ?? 5, 1, RELATION_WINDOWS.peeToPoop);
      const pairWatchWindow = Math.max(30, (peeToPoop.p75 || pairDelay) * 3);

      if (!poopAfterPee && minutesSincePee >= 0 && minutesSincePee <= pairWatchWindow) {
        const pairTime = new Date(peeTime.getTime() + pairDelay * 60000);
        resultTime = pairTime <= now ? new Date(now) : pairTime;
        resultConfidence = Math.min(0.92, resultConfidence + relationConfidenceBoost(peeToPoop) + 0.08);
        resultMessage = resultTime <= now ? '该排便了！' : '尿尿后常会排便';
      } else if (poopAfterPee) {
        const poopTime = new Date(latestPoop.timestamp);
        const minutesSincePoop = (now - poopTime) / 60000;
        const minNextPoop = Math.max(MIN_INTERVAL_MINUTES.poop, adjustedInterval * 0.55);
        if (minutesSincePoop < 120 && resultTime && resultTime < new Date(poopTime.getTime() + minNextPoop * 60000)) {
          resultTime = new Date(poopTime.getTime() + minNextPoop * 60000);
          resultMessage = '刚排便过，继续观察';
        }
      }
    }

    const eatToPoop = relations.eatToPoop;
    const latestEat = latestOfType(records, 'eat');
    if (latestEat && new Date(latestEat.timestamp) <= now && eatToPoop.samples >= 3 && !hasTargetAfter(latestEat, records, 'poop', RELATION_WINDOWS.eatToPoop)) {
      const eatTime = new Date(latestEat.timestamp);
      const relationTime = new Date(eatTime.getTime() + (eatToPoop.median || eatToPoop.avg) * 60000);
      if (resultTime && relationTime < resultTime) {
        resultTime = blendDates(resultTime, relationTime, 0.25);
        resultConfidence = Math.min(0.9, resultConfidence + relationConfidenceBoost(eatToPoop) * 0.5);
      }
    }
  }

  if (type === 'pee') {
    const drinkToPee = relations.drinkToPee;
    const latestDrink = latestOfType(records, 'drink');
    const latestPee = latestOfType(records, 'pee');

    if (latestDrink && new Date(latestDrink.timestamp) <= now && drinkToPee.samples >= 3) {
      const drinkTime = new Date(latestDrink.timestamp);
      const peeAfterDrink = latestPee && new Date(latestPee.timestamp) >= drinkTime;

      if (!peeAfterDrink) {
        const relationTime = new Date(drinkTime.getTime() + (drinkToPee.median || drinkToPee.avg) * 60000);
        if (resultTime && relationTime < resultTime) {
          resultTime = relationTime <= now ? new Date(now) : blendDates(resultTime, relationTime, 0.35);
          resultConfidence = Math.min(0.9, resultConfidence + relationConfidenceBoost(drinkToPee) * 0.75);
          if (relationTime <= now) resultMessage = '该尿尿了！';
        }
      }
    }
  }

  return {
    nextTime: resultTime,
    confidence: parseFloat(resultConfidence.toFixed(2)),
    message: resultMessage
  };
}

export function predictNext(type, records) {
  const typedRecords = records
    .filter(r => r.type === type)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
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

  const today = getCurrentActivityDayKey(records);
  const todayCount = typedRecords.filter(record => getActivityDayKeyForRecord(record, records) === today).length;

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
      nextTime: overdue ? now : next,
      confidence: status && status !== 'normal' ? 0.12 : 0.2,
      message: status && status !== 'normal'
        ? `最近${POOP_STATUS[status].label}，注意观察`
        : (overdue ? `该${TYPE_LABELS[type].name}了！` : '数据较少，仅供参考'),
      todayCount,
      avgInterval: null
    };
  }

  const intervalProfile = computeIntervalProfile(typedRecords);
  const filteredIntervals = intervalProfile.filtered;
  const avgInterval = intervalProfile.stableInterval;

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
  const todMax = Math.max(...tod, 0.001);

  const minWait = Math.max(
    MIN_INTERVAL_MINUTES[type] || 60,
    adjustedInterval * (MIN_INTERVAL_FACTOR[type] || 0.45)
  );
  const earliestReasonable = new Date(lastTime.getTime() + minWait * 60000);
  const searchStart = new Date(Math.max(now.getTime(), earliestReasonable.getTime()));
  const searchEnd = new Date(lastTime.getTime() + 2 * adjustedInterval * 60000);

  let bestSlot = null;
  let bestScore = -Infinity;
  const granularity = 15;

  if (now > intervalBasedTime) {
    bestSlot = new Date(now);
  } else if (searchStart <= searchEnd) {
    const cursor = new Date(searchStart);
    while (cursor <= searchEnd) {
      const mod = cursor.getHours() * 60 + cursor.getMinutes();
      const bucketIndex = Math.round(mod / 15) % 96;

      const todScore = (tod[bucketIndex] || 0) / todMax;

      const diffFromInterval = Math.abs(cursor - intervalBasedTime) / 60000;
      const intervalSigma = Math.max(45, adjustedInterval * 0.25);
      const intervalScore = normalizedGaussianScore(diffFromInterval, intervalSigma);

      const w = WEIGHTS[type];
      const score = w.timeOfDay * todScore + (w.interval + w.recency) * intervalScore;

      if (score > bestScore) {
        bestScore = score;
        bestSlot = new Date(cursor);
      }
      cursor.setTime(cursor.getTime() + granularity * 60000);
    }
  } else {
    bestSlot = intervalBasedTime;
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

  const relationAdjusted = applyRelationAdjustments({
    type,
    records,
    typedRecords,
    nextTime: bestSlot,
    confidence,
    message,
    adjustedInterval,
    now,
    relations: analyzeRhythmRelations(records)
  });
  bestSlot = relationAdjusted.nextTime;
  confidence = relationAdjusted.confidence;
  message = relationAdjusted.message;

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
  const today = getCurrentActivityDayKey(records);
  const todayRecords = getActivityDayRecords(typedRecords, today, records);

  if (typedRecords.length === 0) {
    return {
      type,
      totalRecords: 0,
      avgInterval: null,
      todayCount: 0,
      totalToday: 0,
      activityDayKey: today,
      todayRecords: []
    };
  }

  const lastRecord = typedRecords
    .slice()
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0] || null;

  let totalToday = 0;
  if (type === 'drink' || type === 'eat') {
    totalToday = todayRecords.reduce((sum, r) => sum + (r.amount || 0), 0);
  }

  const poopStats = type === 'poop' ? getPoopStats(typedRecords, todayRecords) : {};

  const intervalProfile = computeIntervalProfile(typedRecords);
  const avgInterval = intervalProfile.stableInterval ? Math.round(intervalProfile.stableInterval) : null;

  return {
    type,
    totalRecords: typedRecords.length,
    avgInterval,
    todayCount: todayRecords.length,
    totalToday,
    todayRecords,
    activityDayKey: today,
    lastTimestamp: lastRecord?.timestamp || null,
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
