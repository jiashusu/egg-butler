import { minuteOfDay } from './utils/time.js';
import { getActivityDayRecords, getCurrentActivityDayKey } from './utils/activityDay.js';
import { analyzeRhythm, pastRecords } from './utils/rhythm.js';
import { POOP_STATUS, normalizePoopStatus, isAbnormalPoop } from './utils/poopStatus.js';

const TYPE_NAMES = { drink: '喝水', eat: '吃饭', poop: '排便', pee: '尿尿' };
const MINUTE = 60000;
const TOILET_LIMIT = 4;

function confidenceMessage(confidence) {
  if (confidence >= 0.7) return '预测可靠 ✓';
  if (confidence >= 0.4) return '预测一般';
  return '数据较少，仅供参考';
}

function clockScore(time, events) {
  if (!events.length) return 0;
  const target = minuteOfDay(new Date(time));
  return events.reduce((sum, event) => {
    const distance = Math.abs(target - minuteOfDay(new Date(event.timestamp)));
    const circularDistance = Math.min(distance, 1440 - distance);
    return sum + Math.exp(-0.5 * (circularDistance / 60) ** 2) * event.weight;
  }, 0) / events.reduce((sum, event) => sum + event.weight, 0);
}

function intervalPrediction(lastRecord, model) {
  const interval = model.interval.minutes;
  const last = Date.parse(lastRecord.timestamp);
  const center = last + interval * MINUTE;
  const spread = Math.min(180, interval * 0.2);
  const minimum = last + Math.max(1, interval * 0.55) * MINUTE;
  let bestTime = center;
  let bestScore = -Infinity;
  // Search around the learned interval, not around now, so an overdue time stays fixed.
  for (let time = Math.max(minimum, center - spread * MINUTE); time <= center + spread * MINUTE; time += 15 * MINUTE) {
    const intervalScore = Math.exp(-0.5 * ((time - center) / (Math.max(30, spread) * MINUTE)) ** 2);
    const score = 0.7 * intervalScore + 0.3 * clockScore(time, model.clockEvents);
    if (score > bestScore) { bestScore = score; bestTime = time; }
  }
  return new Date(Math.round(bestTime / MINUTE) * MINUTE);
}

function predictWithRhythm(type, rhythm, now) {
  const typed = rhythm.records.filter(record => record.type === type);
  const current = rhythm.currentRecords.filter(record => record.type === type);
  const todayCount = current.length;
  const model = rhythm.models[type];
  const base = {
    type, nextTime: null, confidence: model.interval.confidence,
    todayCount, avgInterval: model.interval.minutes,
    intervalMinutes: model.interval.minutes, totalRecords: typed.length
  };
  const isToilet = type === 'poop' || type === 'pee';
  if (type === 'poop' && current.some(record => normalizePoopStatus(record.value) === 'large')) {
    return { ...base, confidence: 1, message: '本轮排便已结束' };
  }
  if (isToilet && todayCount >= TOILET_LIMIT) {
    return { ...base, confidence: 1, message: `本轮已完成${TOILET_LIMIT}次` };
  }
  if (isToilet && rhythm.currentMeal) {
    const stage = model.stages[todayCount];
    const planned = rhythm.currentMeal.getTime() + stage.offset.minutes * MINUTE;
    const last = current.at(-1);
    const anchored = last ? Date.parse(last.timestamp) + Math.max(1, stage.gap.minutes) * MINUTE : planned;
    const nextTime = new Date(Math.max(planned, anchored));
    const confidence = Math.min(stage.offset.confidence, stage.gap.confidence);
    return {
      ...base, nextTime, confidence,
      intervalMinutes: stage.gap.minutes,
      message: now >= nextTime ? `该${TYPE_NAMES[type]}了！`
        : `${confidenceMessage(confidence)}，本轮第${todayCount + 1}/${TOILET_LIMIT}次`
    };
  }
  const last = typed.at(-1);
  if (!last) return { ...base, avgInterval: null, confidence: 0, message: '暂无数据' };

  let nextTime = intervalPrediction(last, model);
  let confidence = model.interval.confidence;
  if (type === 'drink' && rhythm.feedPair.active && rhythm.currentMeal) {
    const latestMeal = rhythm.records.findLast(record => record.type === 'eat');
    const mealTime = Date.parse(latestMeal.timestamp);
    const hasDrink = typed.some(record => Date.parse(record.timestamp) >= mealTime - 15 * MINUTE);
    if (!hasDrink) {
      nextTime = new Date(mealTime + rhythm.feedPair.minutes * MINUTE);
    } else {
      const nextMeal = predictWithRhythm('eat', rhythm, now).nextTime;
      if (nextMeal && Date.parse(last.timestamp) < nextMeal.getTime() - 15 * MINUTE) {
        nextTime = new Date(nextMeal.getTime() + rhythm.feedPair.minutes * MINUTE);
      }
    }
    confidence = Math.min(confidence, rhythm.feedPair.confidence);
  }
  let message = now >= nextTime ? `该${TYPE_NAMES[type]}了！` : confidenceMessage(confidence);
  if (type === 'poop') {
    const abnormal = typed.slice(-3).filter(record => isAbnormalPoop(record.value));
    if (abnormal.length) {
      const status = normalizePoopStatus(abnormal.at(-1).value);
      confidence = Number((confidence * Math.max(0.45, POOP_STATUS[status].healthScore)).toFixed(2));
      message = `最近${POOP_STATUS[status].label}，注意观察`;
    }
  }
  return { ...base, nextTime, confidence, message };
}

export function predictNext(type, records) {
  const now = new Date();
  return predictWithRhythm(type, analyzeRhythm(records, now), now);
}

export function predictAll(records) {
  const now = new Date();
  const rhythm = analyzeRhythm(records, now);
  return Object.fromEntries(Object.keys(TYPE_NAMES).map(type => [type, predictWithRhythm(type, rhythm, now)]));
}

export function getStats(type, records) {
  const now = new Date();
  const sorted = pastRecords(records, now);
  const typedRecords = sorted.filter(record => record.type === type);
  const today = getCurrentActivityDayKey(sorted, now);
  const todayRecords = getActivityDayRecords(typedRecords, today, sorted);
  const lastRecord = typedRecords.at(-1);
  const model = analyzeRhythm(sorted, now).models[type];
  return {
    type, totalRecords: typedRecords.length,
    avgInterval: model.interval.samples > 0 ? model.interval.minutes : null,
    todayCount: todayRecords.length,
    totalToday: ['eat', 'drink'].includes(type) ? todayRecords.reduce((sum, record) => sum + (record.amount || 0), 0) : 0,
    activityDayKey: today, todayRecords,
    lastTimestamp: lastRecord?.timestamp || null,
    ...(type === 'poop' ? getPoopStats(typedRecords, todayRecords) : {})
  };
}

function getPoopStats(records, todayRecords) {
  const breakdown = Object.fromEntries(Object.keys(POOP_STATUS).map(key => [key, 0]));
  for (const record of records) breakdown[normalizePoopStatus(record.value)]++;
  return {
    poopBreakdown: breakdown,
    poopNormalRate: records.length ? (breakdown.normal + breakdown.large) / records.length : 0,
    poopAbnormalToday: todayRecords.filter(record => isAbnormalPoop(record.value)).length,
    poopRecentAbnormalCount: records.slice(-5).filter(record => isAbnormalPoop(record.value)).length
  };
}
