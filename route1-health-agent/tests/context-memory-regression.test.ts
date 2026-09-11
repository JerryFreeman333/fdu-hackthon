import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '../src/types';
import { understandElderInput } from '../src/engine/understanding';

const TODAY = '2026-09-10';

function elder(id: string, text: string): ChatMessage {
  return { id, role: 'elder', text, time: `${TODAY}T10:00:00.000Z` };
}

function agent(id: string, text: string): ChatMessage {
  return { id, role: 'agent', text, time: `${TODAY}T10:01:00.000Z` };
}

test('inherits the unique family subject from the immediately previous health turn', () => {
  const history = [elder('m1', '我爸最近有点喘'), agent('a1', '好的，我知道了。')];
  const result = understandElderInput('他也有点头晕', TODAY, history);

  assert.equal(result.clarificationQuestion, undefined);
  assert.equal(result.claims.length, 1);
  assert.equal(result.claims[0]?.subject, 'father');
  assert.deepEqual(result.claims[0]?.tags, ['dizziness']);
});

test('does not carry an older subject through a newer unrelated health turn', () => {
  const history = [
    elder('m1', '我爸最近有点喘'),
    agent('a1', '好的，我知道了。'),
    elder('m2', '我自己今天有点头晕'),
    agent('a2', '请注意休息。'),
  ];
  const result = understandElderInput('他后来也喘了', TODAY, history);

  assert.match(result.clarificationQuestion ?? '', /指谁|确认清楚/);
  assert.equal(result.claims[0]?.subject, 'unknown');
  assert.deepEqual(result.claims[0]?.tags, ['dyspnea']);
});

test('refuses to inherit when the previous turn established multiple family subjects', () => {
  const history = [elder('m1', '我爸有点喘，我妈也有点头晕'), agent('a1', '我先分别记下。')];
  const result = understandElderInput('他现在也喘得更厉害了', TODAY, history);

  assert.match(result.clarificationQuestion ?? '', /指谁|确认清楚/);
  assert.equal(result.claims[0]?.subject, 'unknown');
  assert.deepEqual(result.claims[0]?.tags, ['dyspnea']);
});

test('does not create a family anchor from a non-health contextual sentence', () => {
  const history = [elder('m1', '我爸今天去菜市场了'), agent('a1', '好的。')];
  const result = understandElderInput('他也喘了', TODAY, history);

  assert.match(result.clarificationQuestion ?? '', /指谁|确认清楚/);
  assert.equal(result.claims[0]?.subject, 'unknown');
});

test('a self-only previous turn cannot become a family pronoun anchor', () => {
  const history = [elder('m1', '我自己今天有点喘'), agent('a1', '知道了。')];
  const result = understandElderInput('他也喘', TODAY, history);

  assert.match(result.clarificationQuestion ?? '', /指谁|确认清楚/);
  assert.equal(result.claims[0]?.subject, 'unknown');
});

test('preserves subject continuity inside a previous multi-clause family turn', () => {
  const history = [elder('m1', '我爸走路不稳，后来摔了一跤'), agent('a1', '我先分别记下。')];
  const result = understandElderInput('他现在还喘', TODAY, history);

  assert.equal(result.claims[0]?.subject, 'father');
  assert.deepEqual(result.claims[0]?.tags, ['dyspnea']);
});
