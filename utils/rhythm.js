import { getActivityDayStarts, getActivityDayRecords, getCurrentActivityDayKey } from './activityDay.js';

const MINUTE = 60000;
const DAY = 24 * 60 * MINUTE;
export const DEFAULT_INTERVALS = { drink: 240, eat: 360, poop: 480, pee: 180 };

export function pastRecords(records, now = new Date()) {
  const end = now.getTime();
  return records.filter(record => Object.hasOwn(DEFAULT_INTERVALS, record?.type)
    && Number.isFinite(Date.parse(record.timestamp)) && Date.parse(record.timestamp) <= end)
    .slice().sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function weightedMedian(samples) {
  const sorted = samples.slice().sort((a, b) => a.minutes - b.minutes);
  const halfway = sorted.reduce((sum, sample) => sum + sample.weight, 0) / 2;
  let weight = 0;
  for (const sample of sorted) {
    weight += sample.weight;
    if (weight >= halfway) return sample.minutes;
  }
  return 0;
}

function estimate(samples, fallback) {
  let clean = samples.filter(sample => Number.isFinite(sample.minutes) && sample.minutes >= 0);
  if (!clean.length) return { minutes: fallback, samples: 0, confidence: 0.1 };
  const center = weightedMedian(clean);
  const deviation = weightedMedian(clean.map(sample => ({ ...sample, minutes: Math.abs(sample.minutes - center) })));
  if (clean.length >= 3) clean = clean.filter(sample => Math.abs(sample.minutes - center) <= Math.max(15, deviation * 3));
  const minutes = Math.round(weightedMedian(clean));
  const totalWeight = clean.reduce((sum, sample) => sum + sample.weight, 0);
  const spread = clean.reduce((sum, sample) => sum + Math.abs(sample.minutes - minutes) * sample.weight, 0) / totalWeight;
  const confidence = Math.max(0.1, Math.min(0.9,
    (0.2 + 0.7 * Math.min(1, clean.length / 7)) / (1 + spread / Math.max(15, minutes))));
  return { minutes, samples: clean.length, confidence: Number(confidence.toFixed(2)) };
}

function collect(cycles, values) {
  return cycles.flatMap((cycle, index) => values(cycle).map(minutes => ({ minutes, weight: index + 1 })));
}

function intervalSamples(cycles, type) {
  return collect(cycles, cycle => {
    const events = cycle.records.filter(record => record.type === type);
    const times = events.map(record => Date.parse(record.timestamp));
    // The next first meal closes a complete cycle and supplies the final meal interval.
    if (type === 'eat') times.push(cycle.end.getTime());
    return times.slice(1).map((time, index) => (time - times[index]) / MINUTE).filter(minutes => minutes > 0);
  });
}

function feedingSamples(cycles, type) {
  const events = cycles.flatMap((cycle, index) => cycle.records
    .filter(record => record.type === type).map(record => ({ time: Date.parse(record.timestamp), weight: index + 1 })));
  return events.slice(1).map((event, index) => ({ minutes: (event.time - events[index].time) / MINUTE, weight: event.weight }))
    .filter(sample => sample.minutes > 0);
}

function stageSamples(cycles, type, index, gap = false) {
  return collect(cycles, cycle => {
    const events = cycle.records.filter(record => record.type === type);
    if (!events[index]) return [];
    const start = gap && index > 0 ? Date.parse(events[index - 1].timestamp) : cycle.start.getTime();
    return [(Date.parse(events[index].timestamp) - start) / MINUTE];
  });
}

function withFallback(primary, older, generic) {
  if (primary.samples >= 2) return primary;
  if (older.samples >= 2) return { ...older, confidence: Math.min(0.5, older.confidence) };
  return generic;
}

function relationSamples(cycles, sourceType, targetType, maxMinutes) {
  return collect(cycles, cycle => {
    const targets = cycle.records.filter(record => record.type === targetType);
    const used = new Set();
    return cycle.records.filter(record => record.type === sourceType).flatMap(source => {
      const target = targets.find(record => !used.has(record)
        && Date.parse(record.timestamp) >= Date.parse(source.timestamp)
        && Date.parse(record.timestamp) - Date.parse(source.timestamp) <= maxMinutes * MINUTE);
      if (!target) return [];
      used.add(target);
      return [(Date.parse(target.timestamp) - Date.parse(source.timestamp)) / MINUTE];
    });
  });
}

export function analyzeRhythm(records, now = new Date()) {
  const sorted = pastRecords(records, now);
  const starts = getActivityDayStarts(sorted);
  const cutoff = now.getTime() - 28 * DAY;
  const olderCycles = starts.slice(0, -1).map((entry, index) => ({
    key: entry.key, start: entry.start, end: starts[index + 1].start,
    records: []
  })).filter(cycle => cycle.start.getTime() >= cutoff);
  let cycleIndex = 0;
  for (const record of sorted) {
    const time = Date.parse(record.timestamp);
    while (cycleIndex < olderCycles.length && time >= olderCycles[cycleIndex].end.getTime()) cycleIndex++;
    const cycle = olderCycles[cycleIndex];
    if (cycle && time >= cycle.start.getTime()) cycle.records.push(record);
  }
  const cycles = olderCycles.slice(-7);
  const start = starts.at(-1);
  const currentKey = start?.key || getCurrentActivityDayKey(sorted, now);
  const currentRecords = start ? sorted.filter(record => Date.parse(record.timestamp) >= start.start.getTime())
    : getActivityDayRecords(sorted, currentKey, sorted);
  const completedRecords = start ? sorted.filter(record => Date.parse(record.timestamp) < start.start.getTime()) : sorted;
  const models = {};
  for (const type of Object.keys(DEFAULT_INTERVALS)) {
    const recentSamples = ['eat', 'drink'].includes(type)
      ? (type === 'eat' ? intervalSamples(cycles, type) : feedingSamples(cycles, type))
      : intervalSamples(cycles, type);
    const olderSamples = ['eat', 'drink'].includes(type)
      ? (type === 'eat' ? intervalSamples(olderCycles, type) : feedingSamples(olderCycles, type))
      : intervalSamples(olderCycles, type);
    const recentEvents = completedRecords.filter(record => record.type === type && Date.parse(record.timestamp) >= cutoff).slice(-20);
    const genericSamples = recentEvents.slice(1).map((record, index) => ({
      minutes: (Date.parse(record.timestamp) - Date.parse(recentEvents[index].timestamp)) / MINUTE, weight: index + 1
    })).filter(sample => sample.minutes > 0);
    const generic = estimate(genericSamples, DEFAULT_INTERVALS[type]);
    const interval = withFallback(estimate(recentSamples, DEFAULT_INTERVALS[type]), estimate(olderSamples, DEFAULT_INTERVALS[type]), generic);
    const stages = ['poop', 'pee'].includes(type) ? Array.from({ length: 4 }, (_, index) => {
      const gap = withFallback(estimate(stageSamples(cycles, type, index, true), interval.minutes),
        estimate(stageSamples(olderCycles, type, index, true), interval.minutes), interval);
      const fallbackOffset = index === 0 ? gap : { ...gap, minutes: 0 };
      const offset = withFallback(estimate(stageSamples(cycles, type, index), gap.minutes),
        estimate(stageSamples(olderCycles, type, index), gap.minutes), fallbackOffset);
      return { gap, offset };
    }) : [];
    const clockEvents = cycles.length ? cycles.flatMap((cycle, index) => cycle.records
      .filter(record => record.type === type).map(record => ({ timestamp: record.timestamp, weight: index + 1 })))
      : recentEvents.map((record, index) => ({ timestamp: record.timestamp, weight: index + 1 }));
    models[type] = { interval, stages, clockEvents };
  }
  const meals = cycles.flatMap((cycle, index) => cycle.records.filter(record => record.type === 'eat')
    .map(record => ({ record, weight: index + 1 })));
  const drinks = completedRecords.filter(record => record.type === 'drink');
  const usedDrinks = new Set();
  const feedSamples = meals.flatMap(({ record: meal, weight }) => {
    const target = drinks.filter(record => !usedDrinks.has(record)
      && Math.abs(Date.parse(record.timestamp) - Date.parse(meal.timestamp)) <= 15 * MINUTE)
      .sort((a, b) => Math.abs(Date.parse(a.timestamp) - Date.parse(meal.timestamp))
        - Math.abs(Date.parse(b.timestamp) - Date.parse(meal.timestamp)))[0];
    if (!target) return [];
    usedDrinks.add(target);
    return [{ minutes: Math.max(0, (Date.parse(target.timestamp) - Date.parse(meal.timestamp)) / MINUTE), weight }];
  });
  const feedPair = estimate(feedSamples, 0);
  return {
    records: sorted, cycles, models,
    currentKey, currentMeal: start?.start || null, currentRecords,
    feedPair: { ...feedPair, active: feedPair.samples >= 2 && feedSamples.length / meals.length >= 0.7 }
  };
}

export function getRhythmRelations(records, now = new Date()) {
  const rhythm = analyzeRhythm(records, now);
  return [
    ['drink', 'pee', 240, '喝水后尿尿'],
    ['pee', 'poop', 90, '尿尿后排便'],
    ['eat', 'poop', 480, '吃饭后排便']
  ].map(([source, target, maxMinutes, label]) => {
    const result = estimate(relationSamples(rhythm.cycles, source, target, maxMinutes), 0);
    return { label, avg: result.minutes, samples: result.samples };
  });
}
