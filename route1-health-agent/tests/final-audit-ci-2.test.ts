import { visibleFamilyEvents } from '../src/engine/familyLedger';
import { acceptedSelfClaims, understandElderInput } from '../src/engine/understanding';
import type { FamilyHealthEvent } from '../src/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const TODAY = '2026-09-08';
const oneTime: FamilyHealthEvent = {
  id: 'one-time',
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
const persistent: FamilyHealthEvent = { ...oneTime, id: 'persistent', shareMode: 'persistent' };

const thirdPerson = understandElderInput('我觉得他喘得厉害', TODAY);
assert(thirdPerson.claims[0]?.subject === 'family_other', 'third-person complaint must stay with family');
assert(acceptedSelfClaims(thirdPerson).length === 0, 'family complaint must never enter elder stream');

const mixed = understandElderInput('我爸今天没吃降压药，我也没吃', TODAY);
assert(mixed.claims.length === 2, 'mixed sentence must retain both person facts');
assert(mixed.claims[0]?.subject === 'father' && mixed.claims[1]?.subject === 'self', 'mixed subjects must remain distinct');
assert(acceptedSelfClaims(mixed).length === 1, 'self medication event must survive');

const improving = understandElderInput('今天没有像昨天那样喘得厉害了', TODAY);
assert(improving.claims[0]?.status === 'occurred', 'comparative improvement is not negation');
assert(improving.claims[0]?.eventDate === TODAY, 'current symptom belongs to today');
assert(acceptedSelfClaims(improving).length === 1, 'improving symptom must remain trackable');

const numeric = understandElderInput('我爸今天血压150/95', TODAY);
assert(numeric.claims[0]?.subject === 'father', 'numeric family fact must keep subject');
assert(numeric.claims[0]?.hasHealthValue === true, 'numeric family fact must keep value marker');

assert(visibleFamilyEvents([persistent], 'granted').length === 1, 'persistent fact should be visible when granted');
assert(visibleFamilyEvents([oneTime], 'granted').length === 0, 'one-time fact must not become persistent');
assert(visibleFamilyEvents([oneTime], 'denied').length === 0, 'denied sharing hides one-time fact');
assert(visibleFamilyEvents([oneTime], 'denied', ['one-time']).length === 1, 'explicit one-time sharing reveals selected fact');
assert(visibleFamilyEvents([oneTime], 'granted').length === 0, 're-enable must not resurrect one-time fact');

console.log('PASS: Route 1 final integrated audit');
