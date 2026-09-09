import { canShareWithFamily, parsePrivacyIntent } from '../src/engine/privacy';

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
