import { visibleFamilyEvents } from '../src/engine/familyLedger';
import { acceptedSelfClaims, understandElderInput } from '../src/engine/understanding';
import type { FamilyHealthEvent } from '../src/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const TODAY = '2026-09-08';

const familyEvent: FamilyHealthEvent = {
  id: 'clean-family-1',
  timestamp: `${TODAY}T12:00:00`,
  source: 'chat',
  subject: 'father',
  text: '我爸今天摔了一下',
  tags: ['fall'],
  hasHealthValue: false,
  status: 'occurred',
  visibility: 'family_ok',
  shareMode: 'one_time',
};

const thirdPerson = understandElderInput('我觉得他喘得厉害', TODAY);
assert(thirdPerson.claims[0]?.subject === 'family_other', 'third-person report must remain a family fact');
assert(acceptedSelfClaims(thirdPerson).length === 0, 'family report must not become an elder fact');

const mixed = understandElderInput('我爸今天没吃降压药，我也没吃', TODAY);
assert(mixed.claims.length === 2, 'mixed sentence must produce two claims');
assert(mixed.claims[0]?.subject === 'father', 'first claim should belong to father');
assert(mixed.claims[1]?.subject === 'self', 'second claim should belong to self');
assert(acceptedSelfClaims(mixed).length === 1, 'self medication-missed event must survive');

const improving = understandElderInput('今天没有像昨天那样喘得厉害了', TODAY);
assert(improving.claims[0]?.status === 'occurred', 'comparative improvement is not negation');
assert(improving.claims[0]?.eventDate === TODAY, 'comparative symptom belongs to today');
assert(acceptedSelfClaims(improving).length === 1, 'improving symptom remains trackable');

assert(visibleFamilyEvents([familyEvent], 'granted').length === 0, 'one-time event must not become persistent');
assert(visibleFamilyEvents([familyEvent], 'denied').length === 0, 'denied sharing must hide one-time event');
assert(
  visibleFamilyEvents([familyEvent], 'denied', [familyEvent.id]).length === 1,
  'explicit one-time share must reveal selected event',
);

console.log('PASS: final clean Route 1 audit');
