import { understandElderInput, acceptedSelfClaims } from '../src/engine/understanding';

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

runCase('same-subject continuation inherits the explicit date instead of defaulting to today', () => {
  const input = understandElderInput('我爸昨天喘，后来更喘了', TODAY);
  const claims = input.claims.filter((claim) => claim.subject === 'father' && claim.tags.includes('dyspnea'));
  assert(claims.length === 2, 'both father breathlessness clauses should remain separate claims');
  assert(claims.every((claim) => claim.eventDate === '2026-09-07'), 'continuation should stay on the explicit previous date');
  assert(!claims.some((claim) => claim.eventDate === TODAY), 'continuation must not silently become today');
});

runCase('same-subject follow-up inherits historical date without inventing a current date', () => {
  const input = understandElderInput('我爸以前喘过，后来又喘了', TODAY);
  const claims = input.claims.filter((claim) => claim.subject === 'father' && claim.tags.includes('dyspnea'));
  assert(claims.length === 2, 'both historical father clauses should remain inspectable');
  assert(claims[0]?.eventDate === null, 'the historical clause should remain undated');
  assert(claims[1]?.eventDate === null, 'the omitted-time continuation must not invent today');
  assert(claims[1]?.timeScope === 'historical', 'historical continuation should preserve historical scope');
});

runCase('explicit later self date overrides inherited family date', () => {
  const input = understandElderInput('我爸昨天喘，今天我也喘', TODAY);
  const fatherClaim = input.claims.find((claim) => claim.subject === 'father' && claim.tags.includes('dyspnea'));
  const selfClaim = input.claims.find((claim) => claim.subject === 'self' && claim.tags.includes('dyspnea'));
  assert(fatherClaim?.eventDate === '2026-09-07', 'father event should stay on yesterday');
  assert(selfClaim?.eventDate === TODAY, 'explicit today must override any prior date context');
});

runCase('cross-subject continuation keeps the sequence date when the elder explicitly appears later', () => {
  const input = understandElderInput('我爸昨天喘，后来我也喘了', TODAY);
  const fatherClaim = input.claims.find((claim) => claim.subject === 'father' && claim.tags.includes('dyspnea'));
  const selfClaim = input.claims.find((claim) => claim.subject === 'self' && claim.tags.includes('dyspnea'));
  assert(fatherClaim?.eventDate === '2026-09-07', 'father event should stay on yesterday');
  assert(selfClaim?.eventDate === '2026-09-07', 'sequence wording should preserve the referenced day');
  assert(acceptedSelfClaims(input).length === 1, 'only the elder symptom should enter the self timeline');
});
