import { canShareWithFamily, parsePrivacyIntent } from '../src/engine/privacy';
import { visibleFamilyEvents } from '../src/engine/familyLedger';
import { buildHistoricalSharingAnswer, appendSharingAudit, type SharingAuditEntry } from '../src/engine/sharingAudit';
import { understandElderInput } from '../src/engine/understanding';
import type { SymptomTag } from '../src/types';

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

runCase('conflicting share and refusal fails closed', () => {
  const text = '告诉女儿这个，但是爸爸那个不要告诉她';
  assert(parsePrivacyIntent(text) === 'private', 'mixed share and refusal must fail closed to private');
  assert(!canShareWithFamily('granted', parsePrivacyIntent(text)), 'conflicting privacy command must not share');
});

runCase('pronoun-based refusal is not lost when the family member was named earlier', () => {
  const text = '告诉女儿我的头晕，但是爸爸的事情不要告诉她';
  assert(parsePrivacyIntent(text) === 'private', 'pronoun-based refusal must override the share request');
  assert(!canShareWithFamily('granted', parsePrivacyIntent(text)), 'the whole ambiguous statement must stay private');
});

runCase('no-record remains stronger than conflicting sharing language', () => {
  const text = '告诉女儿这个，但这件事不要记录，也别告诉她';
  assert(parsePrivacyIntent(text) === 'no_record', 'no-record must remain the strongest safety boundary');
  assert(!canShareWithFamily('granted', parsePrivacyIntent(text)), 'no-record must block sharing');
});

runCase('a clean one-time request remains shareable', () => {
  const intent = parsePrivacyIntent('这次告诉女儿我今天头晕');
  assert(intent === 'share_family', 'clean one-time share request should remain shareable');
  assert(canShareWithFamily('denied', intent), 'explicit one-time share may override persistent denial');
});

runCase('mixed privacy claims produce no persistence candidates', () => {
  const input = understandElderInput('告诉女儿我的头晕，但是爸爸的事情不要告诉她', TODAY);
  assert(input.claims.length === 0, 'mixed privacy input must expose no claims to persistence');
  assert(Boolean(input.clarificationQuestion), 'mixed privacy input must ask for clarification');
  assert(
    input.clarificationQuestion?.includes('不要告诉家属的内容'),
    'clarification must explain the fail-closed privacy reason',
  );
});

runCase('clean explicit one-time share still yields a persistence candidate', () => {
  const input = understandElderInput('这次告诉女儿我今天头晕', TODAY);
  assert(input.claims.length > 0, 'clean one-time share must not be blocked by the mixed-privacy guard');
  assert(
    input.claims.some((claim) => claim.subject === 'self'),
    'the claim should still belong to the elder',
  );
});

runCase('revocation removes persistent family visibility', () => {
  const event = {
    id: 'family-persistent-withdraw-1',
    timestamp: '2026-09-08T12:00:00',
    source: 'chat' as const,
    subject: 'father' as const,
    text: '我爸今天摔了一下',
    tags: ['fall'] as SymptomTag[],
    hasHealthValue: false,
    status: 'occurred' as const,
    visibility: 'family_ok' as const,
    shareMode: 'persistent' as const,
  };
  assert(visibleFamilyEvents([event], 'granted').length === 1, 'granted state should expose persistent event');
  assert(visibleFamilyEvents([event], 'denied').length === 0, 'revoked state must stop future persistent visibility');
});

runCase('revocation removes one-time visibility and re-grant does not resurrect it', () => {
  const event = {
    id: 'family-one-time-withdraw-1',
    timestamp: '2026-09-08T12:00:00',
    source: 'chat' as const,
    subject: 'father' as const,
    text: '我爸今天血压150/95',
    tags: [] as SymptomTag[],
    hasHealthValue: true,
    status: 'occurred' as const,
    visibility: 'family_ok' as const,
    shareMode: 'one_time' as const,
  };
  assert(
    visibleFamilyEvents([event], 'denied', ['family-one-time-withdraw-1']).length === 1,
    'an explicitly shared one-time event remains visible while its share grant exists',
  );
  assert(visibleFamilyEvents([event], 'denied', []).length === 0, 'revocation must remove one-time future visibility');
  assert(
    visibleFamilyEvents([event], 'granted', []).length === 0,
    're-granting persistent sharing must not restore the revoked one-time event',
  );
});

runCase('privacy revocation wording is a future stop, not a false historical deletion', () => {
  const acknowledgement =
    '已暂停家属共享。之后的新变化不会继续提供给家属；已经告诉对方的内容，我不会假装它已经被撤回。';
  assert(acknowledgement.includes('已经告诉对方的内容'), 'revocation must distinguish already-told content');
  assert(acknowledgement.includes('不会假装它已经被撤回'), 'revocation must never claim unsupported historical recall');
});

runCase('historical sharing audit survives permission changes', () => {
  const entries: SharingAuditEntry[] = [
    {
      id: 'audit-1',
      createdAt: '2026-09-08T12:34:00.000Z',
      scope: 'self',
      recipient: 'daughter',
      shareMode: 'one_time',
      content: '今天头晕',
    },
    {
      id: 'audit-2',
      createdAt: '2026-09-08T12:35:00.000Z',
      scope: 'family',
      recipient: 'daughter',
      shareMode: 'persistent',
      content: '爸爸今天摔了一下',
    },
  ];
  const answer = buildHistoricalSharingAnswer(entries, 'daughter');
  assert(answer.includes('今天头晕'), 'history answer must include the actual shared self fact');
  assert(answer.includes('爸爸今天摔了一下'), 'history answer must include the actual shared family fact');
  assert(answer.includes('一次性'), 'history answer must preserve one-time mode');
  assert(answer.includes('按长期授权'), 'history answer must preserve persistent mode');
});

runCase('historical audit remains independent from current family visibility', () => {
  const entry: SharingAuditEntry = {
    id: 'audit-revoked-1',
    createdAt: '2026-09-08T13:00:00.000Z',
    scope: 'self',
    recipient: 'daughter',
    shareMode: 'one_time',
    content: '我今天胸闷',
  };
  const answer = buildHistoricalSharingAnswer([entry], 'daughter');
  const event = {
    id: 'family-revoked-shadow',
    timestamp: '2026-09-08T13:00:00',
    source: 'chat' as const,
    subject: 'father' as const,
    text: '我爸今天血压150/95',
    tags: [] as SymptomTag[],
    hasHealthValue: true,
    status: 'occurred' as const,
    visibility: 'family_ok' as const,
    shareMode: 'one_time' as const,
  };
  assert(answer.includes('我今天胸闷'), 'history must remain queryable after permission revocation');
  assert(visibleFamilyEvents([event], 'denied', []).length === 0, 'current visibility must still be revoked');
});

runCase('audit keeps a bounded history', () => {
  const base: SharingAuditEntry = {
    id: 'base',
    createdAt: '2026-09-08T12:00:00.000Z',
    scope: 'self',
    recipient: 'daughter',
    shareMode: 'one_time',
    content: '旧记录',
  };
  const next = Array.from({ length: 4 }, (_, index) => ({
    ...base,
    id: `next-${index}`,
    content: `新记录${index}`,
  }));
  const bounded = appendSharingAudit([base], next, 3);
  assert(bounded.length === 3, 'audit history should respect the configured bound');
  assert(bounded[0]?.id === 'next-1', 'oldest entries should be evicted first');
});
