import { strict as assert } from 'node:assert';
import { acceptedSelfClaims, understandElderInput } from '../src/engine/understanding';

const today = '2026-09-08';

const family = understandElderInput('我觉得他喘得厉害', today);
assert.equal(family.claims[0]?.subject, 'family_other');
assert.equal(acceptedSelfClaims(family).length, 0);

const improvement = understandElderInput('今天没有像昨天那样喘得厉害了', today);
assert.equal(improvement.claims[0]?.status, 'occurred');
assert.equal(improvement.claims[0]?.eventDate, today);
assert.equal(improvement.claims[0]?.timeScope, 'today');

const mixed = understandElderInput('我爸今天没吃降压药，我也没吃', today);
assert.equal(mixed.claims.length, 2);
assert.equal(mixed.claims[0]?.subject, 'father');
assert.equal(mixed.claims[1]?.subject, 'self');
assert.equal(mixed.claims[0]?.tags.includes('medicationMissed'), true);
assert.equal(mixed.claims[1]?.tags.includes('medicationMissed'), true);
assert.equal(acceptedSelfClaims(mixed).length, 1);

console.log('PASS: route1 final CI smoke');
