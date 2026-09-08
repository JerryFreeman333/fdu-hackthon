import { strict as assert } from 'node:assert';
import { acceptedSelfClaims, understandElderInput } from '../src/engine/understanding';

const TODAY = '2026-09-08';
const YESTERDAY = '2026-09-07';

const cases = [
  {
    name: 'family speech with 我觉得他',
    check: () => {
      const result = understandElderInput('我觉得他喘得厉害', TODAY);
      assert.equal(result.claims[0]?.subject, 'family_other');
      assert.equal(acceptedSelfClaims(result).length, 0);
    },
  },
  {
    name: 'family speech keeps omitted subject after descriptive clause',
    check: () => {
      const result = understandElderInput('我看他今天走路不太稳，摔了一下', TODAY);
      assert.equal(result.claims.length, 2);
      assert.equal(result.claims[0]?.subject, 'family_other');
      assert.equal(result.claims[1]?.subject, 'family_other');
      assert.equal(result.claims[1]?.tags.includes('fall'), true);
      assert.equal(acceptedSelfClaims(result).length, 0);
    },
  },
  {
    name: 'current symptom improves relative to yesterday',
    check: () => {
      const result = understandElderInput('今天没有像昨天那样喘得厉害了', TODAY);
      assert.equal(result.claims[0]?.status, 'occurred');
      assert.equal(result.claims[0]?.eventDate, TODAY);
      assert.equal(result.claims[0]?.timeScope, 'today');
      assert.equal(result.claims[0]?.tags.includes('dyspnea'), true);
      assert.equal(acceptedSelfClaims(result).length, 1);
    },
  },
  {
    name: 'mixed father and self medication omission',
    check: () => {
      const result = understandElderInput('我爸今天没吃降压药，我也没吃', TODAY);
      assert.equal(result.claims.length, 2);
      assert.equal(result.claims[0]?.subject, 'father');
      assert.equal(result.claims[1]?.subject, 'self');
      assert.equal(result.claims[0]?.tags.includes('medicationMissed'), true);
      assert.equal(result.claims[1]?.tags.includes('medicationMissed'), true);
      assert.equal(result.claims[0]?.status, 'occurred');
      assert.equal(result.claims[1]?.status, 'occurred');
      assert.equal(acceptedSelfClaims(result).length, 1);
    },
  },
  {
    name: 'explicit relationship wins over generic pronoun history',
    check: () => {
      const prior = [{ id: 'p1', role: 'elder' as const, text: '我老公昨天胸闷', time: '09:00' }];
      const result = understandElderInput('我爸今天也头晕', TODAY, prior);
      assert.equal(result.claims[0]?.subject, 'father');
    },
  },
  {
    name: 'separate yesterday and today across clauses',
    check: () => {
      const result = understandElderInput('昨天喘得厉害，今天好多了', TODAY);
      assert.equal(result.claims[0]?.eventDate, YESTERDAY);
      assert.equal(result.claims[1]?.eventDate, TODAY);
      assert.equal(result.claims[1]?.status, 'occurred');
    },
  },
];

for (const item of cases) {
  item.check();
  console.log(`PASS: ${item.name}`);
}
