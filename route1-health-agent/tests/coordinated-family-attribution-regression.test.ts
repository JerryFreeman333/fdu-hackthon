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

runCase('coordinated father-and-mother symptom creates two family claims', () => {
  const input = understandElderInput('我爸和我妈都喘', TODAY);
  const father = input.claims.find((claim) => claim.subject === 'father' && claim.tags.includes('dyspnea'));
  const mother = input.claims.find((claim) => claim.subject === 'mother' && claim.tags.includes('dyspnea'));

  assert(father, 'father must receive the coordinated dyspnea claim');
  assert(mother, 'mother must receive the coordinated dyspnea claim');
  assert(acceptedSelfClaims(input).length === 0, 'coordinated family symptoms must not enter the self timeline');
});

runCase('coordinated family claims preserve an explicit event date', () => {
  const input = understandElderInput('我爸和我妈昨天都胸闷', TODAY);
  const familyClaims = input.claims.filter(
    (claim) => ['father', 'mother'].includes(claim.subject) && claim.tags.includes('chestPain'),
  );

  assert(familyClaims.length === 2, 'both family members should keep the same coordinated claim');
  assert(familyClaims.every((claim) => claim.eventDate === '2026-09-07'), 'both claims must stay on yesterday');
});

runCase('ambiguous follow-up after coordinated family statement does not become self fact', () => {
  const input = understandElderInput('我爸和我妈都喘，后来更喘了', TODAY);
  assert(
    !acceptedSelfClaims(input).some((claim) => claim.tags.includes('dyspnea')),
    'an omitted subject after multiple family subjects must not fall back to self',
  );
  assert(input.clarificationQuestion?.includes('确认清楚'), 'ambiguous follow-up should request clarification');
});
