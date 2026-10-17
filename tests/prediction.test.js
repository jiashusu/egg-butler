import test from 'node:test';
import assert from 'node:assert/strict';
import { predictAll, predictNext, getStats } from '../prediction.js';
import { analyzeRhythm, getRhythmRelations } from '../utils/rhythm.js';
import { isAbnormalPoop, normalizePoopStatus, POOP_OPTIONS } from '../utils/poopStatus.js';

const MINUTE = 60000;
const DAY = 1440 * MINUTE;
const MEAL = Date.parse('2026-10-17T14:00:00-05:00');
function event(type, time, value) {
  return { type, timestamp: new Date(time).toISOString(), ...(type === 'poop' ? { value: value || 'normal' } : {}),
    ...(type === 'drink' ? { amount: 607 } : {}), ...(type === 'eat' ? { amount: 465 } : {}) };
}
function training() {
  return Array.from({ length: 7 }, (_, i) => {
    const meal = MEAL - (7 - i) * DAY;
    return [event('eat', meal), event('drink', meal), ...[4, 347, 710].flatMap(delay =>
      [event('pee', meal + delay * MINUTE), event('poop', meal + (delay + 1) * MINUTE)])];
  }).flat();
}
function freeze(t, time) { t.mock.timers.enable({ apis: ['Date'], now: time }); }

test('learns early first toilet events instead of a fixed 4.5 hours', t => {
  freeze(t, MEAL);
  const records = [...training(), event('eat', MEAL), event('drink', MEAL)];
  assert.equal(predictNext('pee', records).nextTime.getTime(), MEAL + 4 * MINUTE);
  assert.equal(predictNext('poop', records).nextTime.getTime(), MEAL + 5 * MINUTE);
  assert.equal(analyzeRhythm(records).cycles.length, 7);
});

test('late actual events anchor the next stage and overdue predictions do not drift', t => {
  const last = MEAL + 500 * MINUTE;
  freeze(t, last + 2 * MINUTE);
  const records = [...training(), event('eat', MEAL), event('poop', last)];
  const first = predictNext('poop', records);
  assert.ok(first.nextTime.getTime() >= last + 300 * MINUTE);
  t.mock.timers.setTime(first.nextTime.getTime() + 60 * MINUTE);
  assert.equal(predictNext('poop', records).nextTime.getTime(), first.nextTime.getTime());
  assert.match(predictNext('poop', records).message, /该排便/);
});

test('large completes only poop; editing or deleting it restores prediction', t => {
  freeze(t, MEAL + 10 * MINUTE);
  const base = [...training(), event('eat', MEAL), event('pee', MEAL + 4 * MINUTE)];
  const large = event('poop', MEAL + 5 * MINUTE, 'large');
  assert.equal(predictNext('poop', [...base, large]).nextTime, null);
  assert.match(predictNext('poop', [...base, large]).message, /本轮排便已结束/);
  assert.ok(predictNext('pee', [...base, large]).nextTime);
  assert.ok(predictNext('poop', [...base, { ...large, value: 'normal' }]).nextTime);
  assert.ok(predictNext('poop', base).nextTime);
  assert.equal(getStats('poop', [...base, large]).poopAbnormalToday, 0);
  assert.equal(getStats('poop', [...base, large]).poopNormalRate, 1);
});

test('four actual events still complete a round without large', t => {
  freeze(t, MEAL + 800 * MINUTE);
  for (const type of ['pee', 'poop']) {
    const records = [...training(), event('eat', MEAL), ...[5, 300, 600, 790].map(delay => event(type, MEAL + delay * MINUTE))];
    assert.equal(predictNext(type, records).nextTime, null);
    assert.match(predictNext(type, records).message, /本轮已完成4次/);
  }
});

test('midnight does not reset a completed round; the next first meal does', t => {
  const records = [...training(), event('eat', MEAL), event('poop', MEAL + 5 * MINUTE, 'large')];
  freeze(t, MEAL + 15 * 60 * MINUTE);
  assert.equal(predictNext('poop', records).nextTime, null);
  const nextMeal = MEAL + DAY;
  t.mock.timers.setTime(nextMeal);
  const next = predictNext('poop', [...records, event('eat', nextMeal)]);
  assert.equal(next.todayCount, 0);
  assert.ok(next.nextTime.getTime() >= nextMeal);
});

test('future records neither complete a round nor train the current model', t => {
  freeze(t, MEAL + MINUTE);
  const base = [...training(), event('eat', MEAL)];
  const result = predictNext('poop', [...base, event('poop', MEAL + 100 * MINUTE, 'large')]);
  assert.equal(result.todayCount, 0);
  assert.ok(result.nextTime);
  assert.equal(getStats('poop', [...base, event('poop', MEAL + 100 * MINUTE, 'large')]).todayCount, 0);
});

test('a partial cycle changes progress but not the learned complete-cycle samples', t => {
  freeze(t, MEAL + 200 * MINUTE);
  const base = [...training(), event('eat', MEAL)];
  const before = analyzeRhythm(base);
  const after = analyzeRhythm([...base, event('poop', MEAL + MINUTE), event('poop', MEAL + 2 * MINUTE)]);
  assert.deepEqual(after.models.poop.interval, before.models.poop.interval);
  assert.deepEqual(after.models.poop.stages, before.models.poop.stages);
});

test('sparse data uses finite defaults and low confidence; no-meal counts remain visible', t => {
  freeze(t, MEAL + 10 * MINUTE);
  assert.equal(predictNext('drink', []).nextTime, null);
  const single = predictNext('drink', [event('drink', MEAL)]);
  assert.ok(Number.isFinite(single.nextTime.getTime()));
  assert.equal(single.todayCount, 1);
  assert.ok(single.confidence <= 0.2);
  const firstMeal = predictNext('poop', [event('eat', MEAL)]);
  assert.ok(Number.isFinite(firstMeal.nextTime.getTime()));
  assert.ok(firstMeal.confidence <= 0.2);
});

test('feeding pair reminders stop after drink is recorded, and refresh is stable', t => {
  freeze(t, MEAL + 10 * MINUTE);
  const base = [...training(), event('eat', MEAL)];
  assert.equal(predictNext('drink', base).nextTime.getTime(), MEAL);
  const done = [...base, event('drink', MEAL)];
  const next = predictAll(done);
  assert.ok(next.drink.nextTime.getTime() > Date.now());
  assert.equal(next.drink.nextTime.getTime(), next.eat.nextTime.getTime());
  t.mock.timers.setTime(MEAL + 12 * 60 * MINUTE);
  assert.equal(predictNext('drink', done).nextTime.getTime(), next.drink.nextTime.getTime());
});

test('relations include same-minute events without pairing a target more than once', t => {
  freeze(t, MEAL);
  const records = [...training(), event('eat', MEAL)];
  const relation = getRhythmRelations(records).find(r => r.label === '尿尿后排便');
  assert.equal(relation.avg, 1);
  assert.equal(relation.samples, 21);
});

test('drinking before a meal counts as paired and multiple daily meals are learned', t => {
  freeze(t, MEAL + 8 * 60 * MINUTE);
  const records = Array.from({ length: 7 }, (_, index) => {
    const morning = MEAL - (7 - index) * DAY;
    return [event('drink', morning - MINUTE), event('eat', morning),
      event('eat', morning + 8 * 60 * MINUTE), event('drink', morning + 8 * 60 * MINUTE)];
  }).flat();
  records.push(event('drink', MEAL - MINUTE), event('eat', MEAL), event('eat', MEAL + 8 * 60 * MINUTE));
  assert.equal(analyzeRhythm(records).feedPair.active, true);
  assert.equal(predictNext('drink', records).nextTime.getTime(), MEAL + 8 * 60 * MINUTE);
  const done = [...records, event('drink', MEAL + 8 * 60 * MINUTE)];
  assert.ok(predictNext('drink', done).nextTime.getTime() > Date.now());
});

test('clock learning remains near midnight rather than averaging into noon', t => {
  const lateMeal = Date.parse('2026-10-17T23:55:00-05:00');
  freeze(t, lateMeal + MINUTE);
  const records = Array.from({ length: 7 }, (_, index) => event('eat', lateMeal - (7 - index) * DAY));
  records.push(event('eat', lateMeal));
  const next = predictNext('eat', records);
  assert.ok(Math.abs(next.nextTime.getTime() - (lateMeal + DAY)) < 60 * MINUTE);
});

test('large supports labels and legacy statuses without being an abnormality', () => {
  assert.ok(POOP_OPTIONS.some(option => option.key === 'large' && option.label === '大量'));
  assert.equal(normalizePoopStatus('大量'), 'large');
  assert.equal(isAbnormalPoop('large'), false);
  assert.equal(isAbnormalPoop('normal'), false);
  assert.equal(isAbnormalPoop('small'), true);
  assert.equal(isAbnormalPoop('diarrhea'), true);
  assert.equal(normalizePoopStatus(null), 'normal');
});
