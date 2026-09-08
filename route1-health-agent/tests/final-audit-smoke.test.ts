import { visibleFamilyEvents } from '../src/engine/familyLedger';
import { acceptedSelfClaims, understandElderInput } from '../src/engine/understanding';
import type { FamilyHealthEvent } from '../src/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const TODAY = '2026-09-08';
const oneTimeEvent: FamilyHealthEvent = {
  id: 'audit-family-1',
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

const persistentEvent: FamilyHealthEvent = { ...oneTimeEvent, id: 'audit-family-2', shareMode: 'persistent' };

const thirdPerson = understandElderInput('我觉得他喘得厉害', TODAY);
assert(thirdPerson.claims[0]?.subject === 'family_other', 'third-person concern must not become self');
assert(acceptedSelfClaims(thirdPerson).length === 0, 'family report must stay out of elder stream');

const mixed = understandElderInput('我爸今天没吃降压药，我也没吃', TODAY);
assert(mixed.claims.length === 2, 'mixed-person sentence must retain both claims');
assert(mixed.claims[0]?.subject === 'father' && mixed.claims[1]?.subject === 'self', 'claims must keep their subjects');
assert(acceptedSelfClaims(mixed).length === 1, 'self medication-missed claim must survive');

const improving = understandElderInput('今天没有像昨天那样喘得厉害了', TODAY);
assert(improving.claims[0]?.status === 'occurred', 'comparative improvement is not full negation');
assert(improving.claims[0]?.eventDate === TODAY, 'current comparison belongs to today');
assert(acceptedSelfClaims(improving).length === 1, 'improving symptom must remain trackable');

assert(visibleFamilyEvents([oneTimeEvent], 'granted').length === 0, 'one-time event must not become persistent');
assert(
  visibleFamilyEvents([persistentEvent], 'granted').length === 1,
  'persistent event should be visible when granted',
);
assert(visibleFamilyEvents([oneTimeEvent], 'denied').length === 0, 'denied sharing must hide one-time event');
assert(
  visibleFamilyEvents([oneTimeEvent], 'denied', [oneTimeEvent.id]).length === 1,
  'explicit one-time share should reveal selected event',
);
assert(
  visibleFamilyEvents([oneTimeEvent], 'granted').length === 0,
  're-enabling long-term sharing must not resurrect an old one-time event',
);

const familyNumeric = understandElderInput('我爸今天血压150/95', TODAY);
assert(familyNumeric.claims[0]?.subject === 'father', 'numeric family fact must keep the family subject');
assert(familyNumeric.claims[0]?.hasHealthValue, 'numeric family fact must retain health-value evidence');

console.log('PASS: final Route 1 audit smoke');
