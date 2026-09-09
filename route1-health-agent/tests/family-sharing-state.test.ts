import type { Finding, FamilyHealthEvent } from '../src/types';
import { collectFamilyNotifications } from '../src/engine/escalate';
import { familyVisibleFindings, consumeOneTimeShareIds } from '../src/engine/familyDisclosure';
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
  assert(visibleFamilyEvents([baseEvent], 'denied').length === 0, 'revoked consent must hide persistent family events');
});

runCase('one-time family events require the explicit event id even when persistent sharing is denied', () => {
  const oneTimeEvent: FamilyHealthEvent = { ...baseEvent, id: 'family-once', shareMode: 'one_time' };
  assert(
    visibleFamilyEvents([oneTimeEvent], 'denied').length === 0,
    'without the explicit id the one-time event stays hidden',
  );
  assert(
    visibleFamilyEvents([oneTimeEvent], 'denied', ['family-once']).length === 1,
    'an explicitly shared one-time event remains visible for the first disclosure',
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
    'the explicit share is visible before consumption',
  );
  assert(visibleFamilyEvents([oneTimeEvent], 'denied', []).length === 0, 'consumed ids make the event disappear');
});

runCase('consuming one-time ids is selective and idempotent', () => {
  const current = ['finding-a', 'finding-b', 'event-c'];
  const once = consumeOneTimeShareIds(current, ['finding-b', 'missing']);
  assert(
    JSON.stringify(once) === JSON.stringify(['finding-a', 'event-c']),
    'consumption must remove only the targeted ids',
  );
  const twice = consumeOneTimeShareIds(once, ['finding-b']);
  assert(JSON.stringify(twice) === JSON.stringify(['finding-a', 'event-c']), 're-consuming an id must be a no-op');
});

const baseFinding: Finding = {
  id: 'finding-once',
  date: '2026-09-08',
  severity: 'urgent',
  title: '需要立即确认',
  detail: 'detail',
  evidence: ['explicit evidence'],
  familyMessage: '请立即联系老人。',
  carePath: '先联系老人确认安全。',
  familyEligible: true,
};

runCase('one-time finding is marked consumable and can be removed after disclosure', () => {
  const notifications = collectFamilyNotifications([baseFinding], 'denied', [baseFinding.id]);
  assert(notifications.length === 1, 'explicit one-time finding should be disclosed once');
  assert(notifications[0]?.oneTime === true, 'explicit finding share must be marked one-time');
  const remainingIds = consumeOneTimeShareIds([baseFinding.id], [baseFinding.id]);
  assert(remainingIds.length === 0, 'consumed finding grant must not survive for refresh');
  assert(
    collectFamilyNotifications([baseFinding], 'denied', remainingIds).length === 0,
    'after consumption the finding must no longer be disclosed',
  );
});

runCase('family finding disclosure remains fail-closed without explicit eligibility', () => {
  const finding = { ...baseFinding, familyEligible: undefined };
  assert(familyVisibleFindings([finding]).length === 0, 'undefined family eligibility must remain hidden');
  assert(collectFamilyNotifications([finding], 'granted').length === 0, 'undefined eligibility must not notify family');
});
