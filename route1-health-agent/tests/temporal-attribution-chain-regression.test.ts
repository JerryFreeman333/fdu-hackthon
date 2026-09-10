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

runCase('three linked clauses keep the same explicit day', () => {
  const input = understandElderInput('我爸昨天喘，后来更喘了，接着又喘了', TODAY);
  const claims = input.claims.filter((claim) => claim.subject === 'father' && claim.tags.includes('dyspnea'));
  assert(claims.length === 3, 'all three linked health clauses should remain');
  assert(
    claims.every((claim) => claim.eventDate === '2026-09-07'),
    'all linked clauses should stay on yesterday',
  );
});

runCase('an irrelevant self interjection does not overwrite the active family time context', () => {
  const input = understandElderInput('我爸昨天喘，我在旁边陪着他，后来我爸又喘了', TODAY);
  const claims = input.claims.filter((claim) => claim.subject === 'father' && claim.tags.includes('dyspnea'));
  assert(claims.length === 2, 'both father health clauses should remain');
  assert(
    claims.every((claim) => claim.eventDate === '2026-09-07'),
    'irrelevant interjection must not reset the family event date',
  );
});
