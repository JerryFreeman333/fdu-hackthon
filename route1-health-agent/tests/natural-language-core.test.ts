import test from 'node:test';
import assert from 'node:assert/strict';
import { splitNaturalLanguageUnits } from '../src/engine/naturalLanguage';
import { understandElderInput } from '../src/engine/understanding';

const TODAY = '2026-09-10';

function claimsOf(text: string) {
  return understandElderInput(text, TODAY).claims;
}

test('core keeps multiple natural-language facts as separate units', () => {
  const units = splitNaturalLanguageUnits('我爸今天喘，后来我也喘了');
  assert.deepEqual(
    units.map((unit) => unit.text),
    ['我爸今天喘', '后来我也喘了'],
  );
  assert.equal(units[1]?.connector, 'later');
});

test('core splits a discourse shift even when the elder omits punctuation', () => {
  const units = splitNaturalLanguageUnits('我爸今天喘后来我也喘了');
  assert.deepEqual(
    units.map((unit) => unit.text),
    ['我爸今天喘', '后来我也喘了'],
  );
  assert.equal(units[1]?.connector, 'later');
});

test('core preserves a family fact followed by an omitted-subject follow-up', () => {
  const claims = claimsOf('我妈昨天胸闷，今天好多了');
  assert.equal(claims.length, 2);
  assert.deepEqual(claims[0]?.tags, ['chestPain']);
  assert.equal(claims[0]?.subject, 'mother');
  assert.deepEqual(claims[1]?.tags, ['chestPain']);
  assert.equal(claims[1]?.subject, 'mother');
});

test('core prevents a third-person observation from being treated as self', () => {
  const claims = claimsOf('我觉得他好像不太舒服');
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.subject, 'family_other');
  assert.equal(claims[0]?.status, 'uncertain');
});

test('core separates two family/self subjects in one utterance', () => {
  const claims = claimsOf('我爸今天喘，后来我也喘了');
  assert.equal(claims.length, 2);
  assert.equal(claims[0]?.subject, 'father');
  assert.deepEqual(claims[0]?.tags, ['dyspnea']);
  assert.equal(claims[1]?.subject, 'self');
  assert.deepEqual(claims[1]?.tags, ['dyspnea']);
});

test('core keeps parallel family measurements bound to their local clauses', () => {
  const claims = claimsOf('血压150/90，我爸的是180/110');
  assert.equal(claims.length, 2);
  assert.equal(claims[0]?.subject, 'self');
  assert.equal(claims[0]?.hasHealthValue, true);
  assert.equal(claims[1]?.subject, 'father');
  assert.equal(claims[1]?.hasHealthValue, true);
});

test('core preserves correction wording as separate units', () => {
  const units = splitNaturalLanguageUnits('刚才说错了，不是我，是我爸');
  assert.deepEqual(
    units.map((unit) => unit.text),
    ['刚才说错了', '不是我', '是我爸'],
  );
});

test('core recognizes discourse connectors without deleting them', () => {
  const units = splitNaturalLanguageUnits('我妈胸闷，不过今天好多了；我爸也喘了');
  assert.equal(units[1]?.text, '不过今天好多了');
  assert.equal(units[1]?.connector, 'however');
  assert.equal(units[2]?.text, '我爸也喘了');
  assert.equal(units[2]?.connector, undefined);
});

test('core does not invent facts from empty or punctuation-only input', () => {
  assert.deepEqual(splitNaturalLanguageUnits('  ，。\n  '), []);
});
