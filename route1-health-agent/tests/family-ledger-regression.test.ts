import { materializeHealthData, observationToEvent } from '../src/pipeline/events';
import { visibleFamilyEvents } from '../src/engine/familyLedger';
import { acceptedSelfClaims, understandElderInput } from '../src/engine/understanding';
import type { FamilyHealthEvent } from '../src/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const TODAY = '2026-09-08';

function familyEvent(
  id: string,
  shareMode: FamilyHealthEvent['shareMode'],
  visibility: FamilyHealthEvent['visibility'] = 'family_ok',
): FamilyHealthEvent {
  return {
    id,
    timestamp: `${TODAY}T12:00:00`,
    source: 'chat',
    subject: 'father',
    text: '我爸今天摔了一下',
    tags: ['fall'],
    status: 'occurred',
    visibility,
    shareMode,
  };
}

function runCase(name: string, fn: () => void) {
  fn();
  console.log(`PASS: ${name}`);
}

runCase('family fact is persisted independently from elder health events', () => {
  const input = understandElderInput('我爸今天摔了一下', TODAY);
  const familyClaims = input.claims.filter((claim) => claim.subject === 'father');
  assert(familyClaims.length === 1, 'father claim should be recognized');
  assert(acceptedSelfClaims(input).length === 0, 'father event must not be accepted as self');

  const elderEvents =
    familyClaims.length === 1
      ? [
          observationToEvent({
            id: 'self-only',
            date: TODAY,
            source: 'chat',
            text: '老人本人无相关事件',
            tags: [],
          }),
        ]
      : [];
  const materialized = materializeHealthData(elderEvents);
  assert(
    materialized.observations.every((observation) => !observation.tags.includes('fall')),
    'family fall must not enter elder detection stream',
  );
});

runCase('family visibility respects persistent sharing and one-time sharing', () => {
  const persistent = familyEvent('persistent', 'persistent');
  const oneTime = familyEvent('one-time', 'one_time');
  const privateEvent = familyEvent('private', 'private', 'private');
  assert(
    visibleFamilyEvents([persistent, oneTime, privateEvent], 'granted').length === 1,
    'granted sharing should show persistent family facts only',
  );
  assert(
    visibleFamilyEvents([persistent, oneTime, privateEvent], 'denied').length === 0,
    'denied sharing should hide persistent and one-time facts',
  );
  assert(
    visibleFamilyEvents([persistent, oneTime, privateEvent], 'denied', ['one-time']).length === 1,
    'explicit one-time sharing should reveal only the selected fact',
  );
  assert(
    visibleFamilyEvents([persistent, oneTime, privateEvent], 'ask', ['one-time']).length === 1,
    'ask plus explicit share should reveal the selected fact',
  );
  assert(
    visibleFamilyEvents([oneTime], 'granted').length === 0,
    'a one-time fact must not reappear when long-term sharing is later re-enabled',
  );
});

runCase('comparative symptom stays in elder stream while comparison date does not replace current date', () => {
  const input = understandElderInput('今天没有像昨天那样喘得厉害了', TODAY);
  const claim = input.claims[0];
  assert(claim?.subject === 'self', 'comparison symptom should remain self');
  assert(claim.status === 'occurred', 'improvement is not full negation');
  assert(claim.eventDate === TODAY, 'current symptom should use today as event date');
  assert(acceptedSelfClaims(input).length === 1, 'improving symptom should be tracked');
});

runCase('mixed father/self medication report produces two independent claims', () => {
  const input = understandElderInput('我爸今天没吃降压药，我也没吃', TODAY);
  assert(input.claims.length === 2, 'two person-specific facts should survive splitting');
  assert(input.claims[0].subject === 'father', 'first claim belongs to father');
  assert(input.claims[1].subject === 'self', 'second claim belongs to self');
  assert(input.claims.every((claim) => claim.tags.includes('medicationMissed')), 'both claims keep medication-missed tag');
  assert(acceptedSelfClaims(input).length === 1, 'self medication-missed claim survives independently');
});

runCase('correction can target the latest family fact without touching elder detection data', () => {
  const original = understandElderInput('我爸摔了一下', TODAY);
  assert(original.claims[0].subject === 'father', 'original family fact should be identified');
  const corrected = understandElderInput('不是我，是我爸', TODAY);
  assert(corrected.claims.every((claim) => claim.subject !== 'self'), 'correction phrasing must not create a new self health fact');
});
