import { visibleFamilyEvents } from '../src/engine/familyLedger';
import type { FamilyHealthEvent } from '../src/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const event: FamilyHealthEvent = {
  id: 'family-ci-1',
  timestamp: '2026-09-08T12:00:00',
  source: 'chat',
  subject: 'father',
  text: '我爸今天摔了一下',
  tags: ['fall'],
  status: 'occurred',
  visibility: 'family_ok',
  shareMode: 'one_time',
};

assert(visibleFamilyEvents([event], 'granted').length === 0, 'one-time family event must not become persistent visibility');
assert(visibleFamilyEvents([event], 'denied').length === 0, 'denied sharing must hide the event');
assert(
  visibleFamilyEvents([event], 'denied', ['family-ci-1']).length === 1,
  'explicit one-time sharing must reveal only the selected family event',
);
console.log('PASS: family ledger CI visibility smoke');
