import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedSelfClaims, understandElderInput } from '../src/engine/understanding';

const TODAY = '2026-09-10';

// Postposed-denial rollback regression gate: denial must not leave an emergency self event behind.
// Final CI verification marker: final clean user push gate 2.
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

test('rhetorical denial cannot become an actual fall', () => {
  const claims = claimsOf('谁说我摔倒了，我没有');
  const fallClaim = claims.find((claim) => claim.tags.includes('fall'));
  assert.ok(fallClaim, '必须保留跌倒语义供解释层判断，但不能丢失这条反驳');
  assert.equal(fallClaim?.subject, 'self');
  assert.equal(fallClaim?.status, 'negated');
  assert.equal(accepted('谁说我摔倒了，我没有').length, 0);
});

test('postposed denial cancels the immediately preceding self event', () => {
  const claims = claimsOf('我摔倒了，没有啊');
  const fallClaim = claims.find((claim) => claim.tags.includes('fall'));
  assert.ok(fallClaim);
  assert.equal(fallClaim?.status, 'negated');
  assert.equal(accepted('我摔倒了，没有啊').length, 0);
});

test('discourse-marked standalone denial cancels the preceding self event', () => {
  const inputs = ['我摔倒了，其实没有', '我摔倒了，不过没有', '我摔倒了，但是没有啊'];
  for (const text of inputs) {
    const claims = claimsOf(text);
    const fallClaim = claims.find((claim) => claim.tags.includes('fall'));
    assert.ok(fallClaim, `${text}: 应保留跌倒语义`);
    assert.equal(fallClaim?.status, 'negated', `${text}: 否定应回滚前面的跌倒`);
    assert.equal(accepted(text).length, 0);
  }
});

test('explicit repeated denial cancels the immediately preceding self event', () => {
  const claims = claimsOf('我摔倒了，不过没摔');
  const fallClaim = claims.find((claim) => claim.tags.includes('fall'));
  assert.ok(fallClaim);
  assert.equal(fallClaim?.status, 'negated');
  assert.equal(accepted('我摔倒了，不过没摔').length, 0);
});

test('resolution wording is not mistaken for postposed denial', () => {
  const text = '我胸闷，后来没有了';
  const claims = claimsOf(text);
  const chestClaim = claims.find((claim) => claim.tags.includes('dyspnea') || claim.tags.includes('chestPain'));
  assert.ok(chestClaim, '应保留原始胸部症状事件');
  assert.equal(chestClaim?.status, 'occurred');
  assert.equal(accepted(text).length, 1);
});

test('question followed by denial is not accepted as a fall', () => {
  const claims = claimsOf('我摔倒了吗？没有');
  const fallClaim = claims.find((claim) => claim.tags.includes('fall'));
  assert.ok(fallClaim);
  assert.equal(fallClaim?.status, 'negated');
  assert.equal(accepted('我摔倒了吗？没有').length, 0);
});

test('real occurrence remains occurred', () => {
  const claims = claimsOf('我今天真的摔倒了');
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.status, 'occurred');
  assert.equal(accepted('我今天真的摔倒了').length, 1);
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

test('explicit hedge overrides near miss', () => {
  const claims = claimsOf('我刚才差点摔倒，但不确定算不算');
  assert.equal(claims.length, 1, 'splitClauses 必须把转折续句并入上一句');
  assert.equal(claims[0]?.status, 'uncertain', '用户明确说"不确定"时，近失不得压制不确定');
  assert.equal(accepted('我刚才差点摔倒，但不确定算不算').length, 0);
});

test('possible-without-fall stays uncertain instead of near miss', () => {
  const claims = claimsOf('我好像差点摔了');
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.status, 'uncertain');
  assert.equal(accepted('我好像差点摔了').length, 0);
});

test('possible negation stays uncertain instead of occurred or negated', () => {
  const claims = claimsOf('我好像没睡好');
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.status, 'uncertain', '用户显式不确定时不得被记成 occurred/poorSleep');
  assert.equal(accepted('我好像没睡好').length, 0);
});

test('maybe no chest pain stays uncertain instead of negated', () => {
  const claims = claimsOf('我好像没胸痛');
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.status, 'uncertain');
  assert.equal(accepted('我好像没胸痛').length, 0);
});

test('not sure beats explicit occurrence in medication', () => {
  const claims = claimsOf('我好像忘了吃药');
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.status, 'uncertain', '"好像忘了吃药" 是 uncertain，不能记成 medicationMissed+occurred');
  assert.equal(accepted('我好像忘了吃药').length, 0);
});

test('negated family event never becomes self event', () => {
  const claims = claimsOf('我爸没有胸痛');
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.subject, 'father');
  assert.equal(claims[0]?.status, 'negated');
  assert.equal(accepted('我爸没有胸痛').length, 0);
});
