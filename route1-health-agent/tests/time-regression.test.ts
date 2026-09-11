import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedSelfClaims, understandElderInput } from '../src/engine/understanding';

const TODAY = '2026-09-10';

const relativePastCases = [
  ['我前天胸闷', '2026-09-08'],
  ['我大前天胸闷', '2026-09-07'],
  ['我三天前胸闷', '2026-09-07'],
  ['我3天前胸闷', '2026-09-07'],
] as const;

for (const [text, expectedDate] of relativePastCases) {
  test(`relative past date is exact and never reassigned to today: ${text}`, () => {
    const input = understandElderInput(text, TODAY);
    assert.equal(input.claims.length, 1);
    assert.equal(input.claims[0]?.timeScope, 'historical');
    assert.equal(input.claims[0]?.eventDate, expectedDate);
    assert.equal(acceptedSelfClaims(input).length, 1);
    assert.notEqual(input.claims[0]?.eventDate, TODAY);
  });
}

test('vague multi-day wording does not invent an exact event date', () => {
  const input = understandElderInput('我过去两天胸闷', TODAY);
  assert.equal(input.claims.length, 1);
  assert.equal(input.claims[0]?.timeScope, 'historical');
  assert.equal(input.claims[0]?.eventDate, null);
  assert.equal(acceptedSelfClaims(input).length, 0);
});

test('current comparison with a health fact still stays on today', () => {
  const input = understandElderInput('我今天比昨天喘得好多了', TODAY);
  assert.equal(input.claims[0]?.timeScope, 'today');
  assert.equal(input.claims[0]?.eventDate, TODAY);
});

test('yesterday remains yesterday-scoped', () => {
  const input = understandElderInput('我昨天胸闷', TODAY);
  assert.equal(input.claims[0]?.timeScope, 'yesterday');
  assert.equal(input.claims[0]?.eventDate, '2026-09-09');
});

test('last night keeps its dedicated scope and exact date', () => {
  const input = understandElderInput('我昨晚胸闷', TODAY);
  assert.equal(input.claims[0]?.timeScope, 'lastNight');
  assert.equal(input.claims[0]?.eventDate, '2026-09-09');
});

test('historical and current health facts keep distinct dates in one utterance', () => {
  const input = understandElderInput('我前天胸闷，今天又胸闷', TODAY);
  assert.equal(input.claims.length, 2);
  assert.equal(input.claims[0]?.timeScope, 'historical');
  assert.equal(input.claims[0]?.eventDate, '2026-09-08');
  assert.equal(input.claims[1]?.timeScope, 'today');
  assert.equal(input.claims[1]?.eventDate, TODAY);
  assert.equal(acceptedSelfClaims(input).length, 2);
});

test('current negation does not erase a separate historical occurrence', () => {
  const input = understandElderInput('我前天胸闷，今天没有胸闷', TODAY);
  assert.equal(input.claims.length, 2);
  assert.equal(input.claims[0]?.timeScope, 'historical');
  assert.equal(input.claims[0]?.eventDate, '2026-09-08');
  assert.equal(input.claims[0]?.status, 'occurred');
  assert.equal(input.claims[1]?.timeScope, 'today');
  assert.equal(input.claims[1]?.eventDate, TODAY);
  assert.equal(input.claims[1]?.status, 'negated');
  assert.equal(acceptedSelfClaims(input).length, 1);
});

test('historical improvement comparison does not become today', () => {
  const input = understandElderInput('我前天胸闷，昨天比前天好多了', TODAY);
  assert.equal(input.claims.length, 2);
  assert.equal(input.claims[0]?.eventDate, '2026-09-08');
  assert.equal(input.claims[1]?.timeScope, 'yesterday');
  assert.equal(input.claims[1]?.eventDate, '2026-09-09');
  assert.equal(input.claims[1]?.status, 'occurred');
  assert.notEqual(input.claims[1]?.eventDate, TODAY);
});
