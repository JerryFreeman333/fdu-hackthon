import test from 'node:test';
import assert from 'node:assert/strict';
import { understandElderInput } from '../src/engine/understanding';
import { resolveTime } from '../src/engine/time';

const TODAY = '2026-09-10';

function claimsOf(text: string) {
  return understandElderInput(text, TODAY).claims;
}

test('today and yesterday resolve to concrete dates', () => {
  const today = resolveTime('今天头晕', TODAY);
  const yesterday = resolveTime('昨天头晕', TODAY);
  assert.deepEqual(today, { scope: 'today', eventDate: TODAY });
  assert.deepEqual(yesterday, { scope: 'yesterday', eventDate: '2026-09-09' });
});

test('last night and the day before yesterday remain distinct from yesterday', () => {
  assert.deepEqual(resolveTime('昨晚睡不好', TODAY), { scope: 'lastNight', eventDate: '2026-09-09' });
  assert.deepEqual(resolveTime('前天摔过', TODAY), { scope: 'daysAgo', eventDate: '2026-09-08' });
});

test('vague historical windows never become today', () => {
  assert.deepEqual(resolveTime('几天前喘过', TODAY), { scope: 'daysAgo', eventDate: null });
  assert.deepEqual(resolveTime('上周摔过', TODAY), { scope: 'lastWeek', eventDate: null });
  assert.deepEqual(resolveTime('以前摔过', TODAY), { scope: 'historical', eventDate: null });
});

test('explicit calendar date stays attached to the claim', () => {
  assert.deepEqual(resolveTime('2026年9月7日胸闷', TODAY), { scope: 'historical', eventDate: '2026-09-07' });
});

test('a historical self event does not enter accepted current self claims', () => {
  const input = claimsOf('我以前摔过');
  assert.equal(input.length, 1);
  assert.equal(input[0]?.timeScope, 'historical');
  assert.equal(input[0]?.eventDate, null);
  assert.equal(input[0]?.subject, 'self');
});

test('an explicit current event still enters accepted self claims', () => {
  const input = claimsOf('我今天头晕');
  assert.equal(input.length, 1);
  assert.equal(input[0]?.timeScope, 'today');
  assert.equal(input[0]?.eventDate, TODAY);
  assert.equal(input[0]?.subject, 'self');
});

test('relative time remains local to each natural-language unit', () => {
  const input = claimsOf('我爸昨天胸闷，今天好多了');
  assert.equal(input.length, 2);
  assert.equal(input[0]?.timeScope, 'yesterday');
  assert.equal(input[0]?.eventDate, '2026-09-09');
  assert.equal(input[1]?.timeScope, 'today');
  assert.equal(input[1]?.eventDate, TODAY);
});

test('future explicit dates are not silently converted into a health event date', () => {
  assert.deepEqual(resolveTime('2026年9月11日头晕', TODAY), { scope: 'unknown', eventDate: null });
});
