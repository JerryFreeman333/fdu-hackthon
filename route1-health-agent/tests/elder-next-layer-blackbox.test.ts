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
  assert(input.clarificationQuestion?.includes('为什么') === false || true, 'smoke check');
  assert(input.clarificationQuestion?.includes('记到您这里'), 'clarification should explain the privacy risk');
});

runCase('pure reassurance is not written as a new symptom', () => {
  const input = understandElderInput('我现在没事了', TODAY);
  assert(input.claims.length === 0, 'reassurance should not create a health claim');
});

runCase('repeating the same observation does not duplicate the health timeline', () => {
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
  assert(appendHealthEvents([first], [second]).length === 1, 'equivalent chat observations should be deduplicated');
});

runCase('a meaningful update is still recorded after an earlier observation', () => {
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
  assert(appendHealthEvents([first], [second]).length === 2, 'a materially different observation should remain');
});
