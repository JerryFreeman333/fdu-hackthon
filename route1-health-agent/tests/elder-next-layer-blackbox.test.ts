import { appendHealthEvents, observationToEvent } from '../src/pipeline/events';
import { understandElderInput } from '../src/engine/understanding';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runCase(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

const TODAY = '2026-09-08';

runCase('ambiguous family clarification protects the elder record', () => {
  const input = understandElderInput('他摔了', TODAY, [
    { id: '1', role: 'elder', text: '我爸走路不稳', time: '09-07 10:00' },
    { id: '2', role: 'elder', text: '我老公也不舒服', time: '09-07 10:01' },
  ]);
  assert(input.claims[0]?.subject === 'unknown', 'ambiguous pronoun must remain unknown');
  assert(input.clarificationQuestion?.includes('确认清楚'), 'clarification should explain why confirmation is needed');
  assert(input.clarificationQuestion?.includes('记到您这里'), 'clarification should explain the privacy risk');
});

runCase('pure reassurance is not written as a new symptom', () => {
  const input = understandElderInput('我现在没事了', TODAY);
  assert(input.claims.length === 0, 'reassurance should not create a health claim');
});

runCase('negative symptom is not accepted as an occurred self fact', () => {
  const input = understandElderInput('我没有胸痛', TODAY);
  assert(input.claims.length === 1, 'negative statement should remain inspectable');
  assert(input.claims[0]?.status === 'negated', 'negative chest-pain statement must be negated');
  assert(input.claims[0]?.tags.includes('chestPain'), 'negative statement should retain its semantic subject');
});

runCase('contrast sentence preserves the real symptom after a negation', () => {
  const input = understandElderInput('我没胸痛，但是现在喘', TODAY);
  assert(input.claims.some((claim) => claim.tags.includes('chestPain') && claim.status === 'negated'), 'chest pain must stay negated');
  assert(input.claims.some((claim) => claim.tags.includes('dyspnea') && claim.status === 'occurred'), 'dyspnea must remain an occurred fact');
});

runCase('near-miss fall is not treated as an actual fall', () => {
  const input = understandElderInput('我刚才差点摔倒', TODAY);
  assert(input.claims.length === 1, 'near-miss fall should remain inspectable');
  assert(input.claims[0]?.tags.includes('fall'), 'near-miss should retain fall semantics');
  assert(input.claims[0]?.status === 'uncertain', 'near-miss fall must not be classified as occurred');
});

runCase('hypothetical fall is not treated as an actual fall', () => {
  const input = understandElderInput('如果我摔倒了怎么办', TODAY);
  assert(input.claims.length === 1, 'hypothetical fall should remain inspectable');
  assert(input.claims[0]?.status === 'hypothetical', 'hypothetical fall must not be classified as occurred');
});

runCase('repeating the same chat health fact does not duplicate the health timeline', () => {
  const first = observationToEvent({
    id: 'obs-live-1',
    date: TODAY,
    source: 'chat',
    text: '今天头有点晕',
    tags: ['dizziness'],
    visibility: 'private',
  });
  const second = observationToEvent({
    id: 'obs-live-2',
    date: TODAY,
    source: 'chat',
    text: ' 今天头有点晕 ',
    tags: ['dizziness'],
    visibility: 'private',
  });
  assert(appendHealthEvents([first], [second]).length === 1, 'equivalent repeated chat facts should be stored once');
});

runCase('a meaningful update is not swallowed by chat dedupe', () => {
  const first = observationToEvent({
    id: 'obs-live-1',
    date: TODAY,
    source: 'chat',
    text: '今天头有点晕',
    tags: ['dizziness'],
    visibility: 'private',
  });
  const second = observationToEvent({
    id: 'obs-live-2',
    date: TODAY,
    source: 'chat',
    text: '今天头晕比早上严重',
    tags: ['dizziness'],
    visibility: 'private',
  });
  assert(appendHealthEvents([first], [second]).length === 2, 'meaningfully different observations should both remain');
});
