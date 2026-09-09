import { runDetection } from '../src/engine/detect';
import { observationToEvent, type HealthEvent } from '../src/pipeline/events';
import type { Observation } from '../src/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const oldPrivate: Observation = {
  id: 'privacy-old-private-fatigue',
  date: '2026-09-06',
  source: 'chat',
  text: '前几天我很累',
  tags: ['fatigue'],
  visibility: 'private',
};

const currentShared: Observation = {
  id: 'privacy-current-shared-fatigue',
  date: '2026-09-08',
  source: 'chat',
  text: '今天还是有点累',
  tags: ['fatigue'],
  visibility: 'family_ok',
};

const events: HealthEvent[] = [
  observationToEvent(oldPrivate),
  observationToEvent(currentShared),
];
const findings = runDetection(events, '2026-09-08');
const fatigueFinding = findings.find((finding) => finding.ruleId === 'symptom.fatigue.reminder');

assert(fatigueFinding, 'current shared fatigue should still produce its own reminder finding');
assert(
  fatigueFinding.familyEligible === true,
  'an old private fatigue observation must not suppress a newer shared finding',
);

console.log('PASS: private observation privacy is scoped to its own finding evidence');
