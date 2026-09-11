import test from 'node:test';
import assert from 'node:assert/strict';
import { understandElderInput } from '../src/engine/understanding';

const TODAY = '2026-09-10';

function claimsOf(text: string, recentMessages = []) {
  return understandElderInput(text, TODAY, recentMessages).claims;
}

test('unresolved pronoun never defaults to self', () => {
  const claims = claimsOf('他好像喘得厉害');
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.subject, 'unknown');
  assert.equal(claims[0]?.status, 'uncertain');
});

test('one clear family antecedent resolves a later pronoun', () => {
  const claims = claimsOf('他也喘了', [{ id: '1', role: 'elder', text: '我爸今天喘', time: '09-10 10:00' }]);
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.subject, 'father');
});

test('two possible family antecedents force unknown instead of guessing', () => {
  const claims = claimsOf('他也喘了', [
    { id: '1', role: 'elder', text: '我爸今天喘', time: '09-10 10:00' },
    { id: '2', role: 'elder', text: '我妈也喘', time: '09-10 10:01' },
  ]);
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.subject, 'unknown');
});

test('same-turn pronoun follows the nearest unique family subject', () => {
  const claims = claimsOf('我爸今天喘，后来他也摔了');
  assert.equal(claims.length, 2);
  assert.equal(claims[0]?.subject, 'father');
  assert.equal(claims[1]?.subject, 'father');
});

test('explicit elder self subject remains self even after a family subject', () => {
  const claims = claimsOf('我爸今天喘，后来我也喘了');
  assert.equal(claims.length, 2);
  assert.equal(claims[0]?.subject, 'father');
  assert.equal(claims[1]?.subject, 'self');
});

test('spouse aliases resolve to spouse', () => {
  const claims = claimsOf('老伴今天也头晕');
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.subject, 'spouse');
});

test('two explicit family members become two independent claims', () => {
  const claims = claimsOf('我爸和我妈都喘');
  assert.equal(claims.length, 2);
  assert.deepEqual(
    claims.map((claim) => claim.subject),
    ['father', 'mother'],
  );
});

test('self and family in one coordinated clause stay separate', () => {
  const claims = claimsOf('我和我爸都喘');
  assert.equal(claims.length, 2);
  assert.deepEqual(
    claims.map((claim) => claim.subject),
    ['self', 'father'],
  );
});
