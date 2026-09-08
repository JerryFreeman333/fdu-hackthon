import { canShareWithFamily, parsePrivacyIntent, sharingLabel } from '../src/engine/privacy';
import { visibleFamilyEvents } from '../src/engine/familyLedger';
import { buildFamilyAcknowledgement } from '../src/engine/userFacing';
import { acceptedSelfClaims, understandElderInput } from '../src/engine/understanding';

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

runCase('family-only response names the person and echoes the fact', () => {
  const text = buildFamilyAcknowledgement([{ subject: 'father', text: '我爸今天血压150/95' }]);
  assert(text.includes('您爸爸'), 'response should identify father');
  assert(text.includes('150/95'), 'response should echo the concrete value');
  assert(text.includes('不会记到您本人的健康档案'), 'response should explain the privacy boundary');
});

runCase('mixed family and self input still acknowledges the family fact', () => {
  const input = understandElderInput('我爸今天没吃降压药，我也没吃', TODAY);
  const family = input.claims.filter((claim) => claim.subject === 'father');
  const self = acceptedSelfClaims(input);
  const text = buildFamilyAcknowledgement(family.map((claim) => ({ subject: 'father' as const, text: claim.text })));
  assert(family.length === 1, 'family claim should survive');
  assert(self.length === 1, 'self claim should survive');
  assert(text.includes('您爸爸'), 'mixed response should explicitly mention father');
  assert(text.includes('没吃降压药'), 'mixed response should not hide the family action');
});

runCase('one-time share is explicitly different from long-term sharing', () => {
  const text = buildFamilyAcknowledgement([{ subject: 'father', text: '我爸今天摔了一下' }], 'one_time');
  assert(text.includes('这次会分享给家属一次'), 'one-time share should be explicit');
  assert(text.includes('不会打开长期共享'), 'one-time share should not imply persistent consent');
});

runCase('persistent sharing is described as currently authorized', () => {
  const text = buildFamilyAcknowledgement([{ subject: 'father', text: '我爸今天血压150/95' }], 'persistent');
  assert(text.includes('按您现在的授权'), 'persistent sharing should reference current consent');
  assert(text.includes('必要的变化'), 'persistent sharing should stay scoped to necessary changes');
});

runCase('ambiguous family pronoun asks rather than silently guessing', () => {
  const input = understandElderInput('他摔了', TODAY, [
    { id: '1', role: 'elder', text: '我爸走路不稳', time: '09-07 10:00' },
    { id: '2', role: 'elder', text: '我老公也不舒服', time: '09-07 10:01' },
  ]);
  assert(input.claims[0]?.subject === 'unknown', 'ambiguous pronoun must remain unknown');
  assert(Boolean(input.clarificationQuestion), 'user should get a clarification question');
  assert(
    input.clarificationQuestion?.includes('为什么') || input.clarificationQuestion?.includes('这样'),
    'clarification should explain why confirmation is needed',
  );
  assert(input.clarificationQuestion?.includes('记到您这里'), 'clarification should reassure about privacy');
});

runCase('current improvement does not sound like a denial of the symptom', () => {
  const input = understandElderInput('今天没有像昨天那样喘得厉害了', TODAY);
  assert(input.claims[0]?.status === 'occurred', 'improvement should remain an occurred symptom');
  assert(input.claims[0]?.eventDate === TODAY, 'improvement should belong to today');
});

runCase('user can state two people in one breath', () => {
  const input = understandElderInput('我爸今天摔了一下，我自己头有点晕', TODAY);
  assert(input.claims.length === 2, 'two facts should remain separate');
  assert(input.claims[0]?.subject === 'father', 'first fact should belong to father');
  assert(input.claims[1]?.subject === 'self', 'second fact should belong to self');
});

runCase('user can correct the person without losing the distinction', () => {
  const input = understandElderInput('不是我，是我爸摔了', TODAY);
  assert(
    input.claims.some((claim) => claim.subject === 'father'),
    'correction should point to father',
  );
  assert(acceptedSelfClaims(input).length === 0, 'correction should not create a self fall');
});

runCase('natural-language privacy refusal is understood', () => {
  assert(parsePrivacyIntent('我不想让孩子知道这件事') === 'private', 'user refusal should block family sharing');
  assert(parsePrivacyIntent('我不希望女儿知道') === 'private', 'user refusal should recognize daughter wording');
  assert(parsePrivacyIntent('我想告诉女儿') === 'share_family', 'explicit sharing request should remain a share');
});

runCase('no-record request stays stronger than family sharing', () => {
  assert(parsePrivacyIntent('这件事不要记录，也别告诉孩子') === 'no_record', 'no-record request should win first');
});

runCase('persistent consent can be revoked without preserving future visibility', () => {
  assert(canShareWithFamily('granted', 'none'), 'granted should permit persistent sharing');
  assert(!canShareWithFamily('denied', 'none'), 'denied should stop persistent sharing');
  assert(sharingLabel('denied') === '暂不与家属共享', 'denied state should be visible to the elder');
});

runCase('one-time sharing works even after persistent consent is revoked', () => {
  assert(canShareWithFamily('denied', 'share_family'), 'explicit one-time share should override persistent denial');
  assert(!canShareWithFamily('denied', 'private'), 'explicit privacy refusal must still block sharing');
});

runCase('one-time sharing does not mutate the persistent decision', () => {
  const persistentStateBefore = 'denied' as const;
  const intent = parsePrivacyIntent('这次告诉女儿');
  assert(intent === 'share_family', 'explicit one-time wording should become share intent');
  assert(canShareWithFamily(persistentStateBefore, intent), 'the one-time statement should still be shareable');
  assert(
    !canShareWithFamily(persistentStateBefore, 'none'),
    'the persistent denial must remain in force after the one-time decision',
  );
});

runCase('revoking persistent sharing hides previously persistent events from the family view', () => {
  const event = {
    id: 'family-persistent-1',
    timestamp: '2026-09-08T12:00:00',
    source: 'chat' as const,
    subject: 'father' as const,
    text: '我爸今天摔了一下',
    tags: ['fall'] as const,
    hasHealthValue: false,
    status: 'occurred' as const,
    visibility: 'family_ok' as const,
    shareMode: 'persistent' as const,
  };
  assert(visibleFamilyEvents([event], 'granted').length === 1, 'persistent event should be visible before revocation');
  assert(
    visibleFamilyEvents([event], 'denied').length === 0,
    'persistent event should disappear from future family view',
  );
});

runCase('clearing one-time share ids stops future access and re-grant does not resurrect them', () => {
  const event = {
    id: 'family-live-1',
    timestamp: '2026-09-08T12:00:00',
    source: 'chat' as const,
    subject: 'father' as const,
    text: '我爸今天摔了一下',
    tags: ['fall'] as const,
    hasHealthValue: false,
    status: 'occurred' as const,
    visibility: 'family_ok' as const,
    shareMode: 'one_time' as const,
  };
  assert(visibleFamilyEvents([event], 'granted', ['family-live-1']).length === 1, 'shared event should be visible');
  assert(visibleFamilyEvents([event], 'denied', []).length === 0, 'clearing ids should hide the one-time event');
  assert(
    visibleFamilyEvents([event], 'granted', []).length === 0,
    're-granting persistent sharing must not resurrect an old one-time event',
  );
});
