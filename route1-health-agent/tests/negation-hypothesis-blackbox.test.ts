import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedSelfClaims, understandElderInput } from '../src/engine/understanding';

const TODAY = '2026-09-10';

// Final CI verification marker: formatter trigger for remaining test format.
function claimsOf(text: string) {
  return understandElderInput(text, TODAY).claims;
}

function accepted(text: string) {
  const claims = claimsOf(text);
  return acceptedSelfClaims({ claims, recallRequested: false, correction: false });
}

test('explicit negation is not accepted as a self health fact', () => {
  const claims = claimsOf('我今天没有胸痛');
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.subject, 'self');
  assert.equal(claims[0]?.status, 'negated');
  assert.equal(accepted('我今天没有胸痛').length, 0);
});

test('negation with natural elder wording stays negated', () => {
  const claims = claimsOf('今天倒是没喘，也没胸闷');
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.status, 'negated');
  assert.equal(accepted('今天倒是没喘，也没胸闷').length, 0);
});

test('hypothetical health question is never treated as an occurrence', () => {
  const claims = claimsOf('如果晚上胸闷怎么办');
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.status, 'hypothetical');
  assert.equal(accepted('如果晚上胸闷怎么办').length, 0);
});

test('possible symptom wording remains uncertain rather than occurred', () => {
  const claims = claimsOf('我可能有点心慌');
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.status, 'uncertain');
  assert.equal(accepted('我可能有点心慌').length, 0);
});

test('near miss is not recorded as an actual accident', () => {
  const claims = claimsOf('我刚才差点摔倒，幸好扶住了');
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.status, 'near_miss');
  assert.equal(accepted('我刚才差点摔倒，幸好扶住了').length, 0);
});

test('family near miss is also excluded from the self fact stream', () => {
  const claims = claimsOf('我爸昨天差点摔倒');
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.subject, 'father');
  assert.equal(claims[0]?.status, 'near_miss');
});

test('real occurrence remains occurred', () => {
  const claims = claimsOf('我今天真的摔倒了');
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.status, 'occurred');
  assert.equal(accepted('我今天真的摔倒了').length, 1);
});

test('negated family event never becomes self event', () => {
  const claims = claimsOf('我爸没有胸痛');
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.subject, 'father');
  assert.equal(claims[0]?.status, 'negated');
  assert.equal(accepted('我爸没有胸痛').length, 0);
});
