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
  const text = buildFamilyAcknowledgement(family.map((claim) => ({ subject: claim.subject, text: claim.text })));
  assert(family.length === 1, 'family claim should survive');
  assert(self.length === 1, 'self claim should survive');
  assert(text.includes('您爸爸'), 'mixed response should explicitly mention father');
  assert(text.includes('没吃降压药'), 'mixed response should not hide the family action');
});

runCase('ambiguous family pronoun asks rather than silently guessing', () => {
  const input = understandElderInput('他摔了', TODAY, [
    { id: '1', role: 'elder', text: '我爸走路不稳', time: '09-07 10:00' },
    { id: '2', role: 'elder', text: '我老公也不舒服', time: '09-07 10:01' },
  ]);
  assert(input.claims[0]?.subject === 'unknown', 'ambiguous pronoun must remain unknown');
  assert(Boolean(input.clarificationQuestion), 'user should get a clarification question');
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
