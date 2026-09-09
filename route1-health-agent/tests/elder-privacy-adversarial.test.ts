import { canShareWithFamily, parsePrivacyIntent } from '../src/engine/privacy';
import { visibleFamilyEvents } from '../src/engine/familyLedger';
import { understandElderInput } from '../src/engine/understanding';

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
  assert(
    !canShareWithFamily('granted', parsePrivacyIntent(text)),
    'the whole ambiguous statement must stay private',
  );
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
  assert(
    input.claims.length > 0,
    'clean one-time share must not be blocked by the mixed-privacy guard',
  );
  assert(input.claims.some((claim) => claim.subject === 'self'), 'the claim should still belong to the elder');
});

runCase('revocation removes persistent family visibility', () => {
  const event = {
    id: 'family-persistent-withdraw-1',
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
  assert(visibleFamilyEvents([event], 'granted').length === 1, 'granted state should expose persistent event');
  assert(
    visibleFamilyEvents([event], 'denied').length === 0,
    'revoked state must stop future persistent visibility',
  );
});

runCase('revocation removes one-time visibility and re-grant does not resurrect it', () => {
  const event = {
    id: 'family-one-time-withdraw-1',
    timestamp: '2026-09-08T12:00:00',
    source: 'chat' as const,
    subject: 'father' as const,
    text: '我爸今天血压150/95',
    tags: [] as const,
    hasHealthValue: true,
    status: 'occurred' as const,
    visibility: 'family_ok' as const,
    shareMode: 'one_time' as const,
  };
  assert(
    visibleFamilyEvents([event], 'denied', ['family-one-time-withdraw-1']).length === 1,
    'an explicitly shared one-time event remains visible while its share grant exists',
  );
  assert(
    visibleFamilyEvents([event], 'denied', []).length === 0,
    'revocation must remove one-time future visibility',
  );
  assert(
    visibleFamilyEvents([event], 'granted', []).length === 0,
    're-granting persistent sharing must not restore the revoked one-time event',
  );
});

runCase('privacy revocation wording is a future stop, not a false historical deletion', () => {
  const acknowledgement =
    '已暂停家属共享。之后的新变化不会继续提供给家属；已经告诉对方的内容，我不会假装它已经被撤回。';
  assert(acknowledgement.includes('已经告诉对方的内容'), 'revocation must distinguish already-told content');
  assert(
    acknowledgement.includes('不会假装它已经被撤回'),
    'revocation must never claim an unsupported historical recall',
  );
});
