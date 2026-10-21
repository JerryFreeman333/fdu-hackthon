import { visibleFamilyEvents } from '../src/engine/familyLedger';
import type { FamilyHealthEvent } from '../src/types';

const event: FamilyHealthEvent = {
  id: 'ci-persistent',
  timestamp: '2026-09-08T12:00:00',
  source: 'chat',
  subject: 'father',
  text: '我爸今天摔了一下',
  tags: ['fall'],
  status: 'occurred',
  visibility: 'family_ok',
  shareMode: 'persistent',
};

if (visibleFamilyEvents([event], 'granted').length !== 1) throw new Error('persistent family event should be visible');
if (visibleFamilyEvents([event], 'denied').length !== 0) throw new Error('revoked family sharing should hide persistent event');
console.log('PASS: main CI family visibility smoke');
