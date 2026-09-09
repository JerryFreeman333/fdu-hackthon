import type { FamilyHealthEvent } from '../src/types';
import { visibleFamilyEvents } from '../src/engine/familyLedger';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runCase(name: string, fn: () => void) {
  fn();
  console.log(`PASS: ${name}`);
}

const baseEvent: FamilyHealthEvent = {
  id: 'family-1',
  timestamp: '2026-09-08T12:00:00Z',
  source: 'chat',
  subject: 'father',
  text: '我爸今天走路不稳',
  tags: ['fall'],
  hasHealthValue: false,
  status: 'occurred',
  visibility: 'family_ok',
  shareMode: 'persistent',
};

runCase('persistent family events disappear immediately after consent is revoked', () => {
  assert(
    visibleFamilyEvents([baseEvent], 'granted').length === 1,
    'granted consent should expose persistent family events',
  );
  assert(
    visibleFamilyEvents([baseEvent], 'denied').length === 0,
    'revoked consent must hide persistent family events',
  );
});

runCase('one-time family events require the explicit event id even when persistent sharing is denied', () => {
  const oneTimeEvent: FamilyHealthEvent = { ...baseEvent, id: 'family-once', shareMode: 'one_time' };
  assert(
    visibleFamilyEvents([oneTimeEvent], 'denied').length === 0,
    'without the explicit id the one-time event stays hidden',
  );
  assert(
    visibleFamilyEvents([oneTimeEvent], 'denied', ['family-once']).length === 1,
    'an explicitly shared one-time event remains visible for that sharing record',
  );
});

runCase('private family events never become visible through one-time sharing', () => {
  const privateEvent: FamilyHealthEvent = {
    ...baseEvent,
    id: 'family-private',
    visibility: 'private',
    shareMode: 'one_time',
  };
  assert(
    visibleFamilyEvents([privateEvent], 'denied', ['family-private']).length === 0,
    'private visibility must override a stale one-time id',
  );
});

runCase('revocation plus cleared one-time ids removes previously explicit family visibility', () => {
  const oneTimeEvent: FamilyHealthEvent = { ...baseEvent, id: 'family-once-2', shareMode: 'one_time' };
  assert(
    visibleFamilyEvents([oneTimeEvent], 'denied', ['family-once-2']).length === 1,
    'the explicit share is visible before revocation state is cleared',
  );
  assert(
    visibleFamilyEvents([oneTimeEvent], 'denied', []).length === 0,
    'cleared ids make the event disappear',
  );
});
