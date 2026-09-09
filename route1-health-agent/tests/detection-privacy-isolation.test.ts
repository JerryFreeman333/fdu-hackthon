import { observationToEvent } from '../src/pipeline/events';
import { runDetection } from '../src/engine/detect';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const TODAY = '2026-09-08';

const oldPrivateFall = {
  id: 'obs-old-private-fall',
  date: '2026-09-01',
  source: 'chat' as const,
  text: '上周摔了一下，先别告诉孩子们',
  tags: ['fall' as const],
  visibility: 'private' as const,
};

const currentFamilyOkFall = {
  id: 'obs-current-family-fall',
  date: TODAY,
  source: 'chat' as const,
  text: '我今天又摔了一下，可以告诉孩子们',
  tags: ['fall' as const],
  visibility: 'family_ok' as const,
};

const findings = runDetection(
  [observationToEvent(oldPrivateFall), observationToEvent(currentFamilyOkFall)],
  TODAY,
);

const fall = findings.find((finding) => finding.ruleId === 'safety.fall');
assert(Boolean(fall), "today's fall must still produce the safety finding");
assert(fall?.severity === 'urgent', "today's fall must remain urgent");
assert(fall?.familyEligible === true, "today's family-ok fall must remain family eligible");
assert(Boolean(fall?.familyMessage), "today's family-ok fall must retain the family message");

const familyMessage = fall?.familyMessage ?? '';
assert(familyMessage.includes(TODAY), "family message must refer to today's event");
assert(!familyMessage.includes('上周'), "family message must not inherit historical private content");

console.log("PASS: historical private fall cannot suppress today's family-ok emergency");
