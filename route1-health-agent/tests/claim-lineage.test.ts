import type { FamilyHealthEvent, HealthMeasurement, Observation } from '../src/types';
import { claimIdForMessage, removeCorrectedChatEvents, removeCorrectedFamilyEvents } from '../src/engine/claimLineage';
import { measurementToEvent, observationToEvent, type HealthEvent } from '../src/pipeline/events';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runCase(name: string, fn: () => void) {
  fn();
  console.log(`PASS: ${name}`);
}

const text = '我今天血压168，刚才头晕';
const firstClaimId = claimIdForMessage(text, 0);
const secondClaimId = claimIdForMessage(text, 1);

runCase('claim ids are deterministic and distinct by claim index', () => {
  assert(claimIdForMessage(text, 0) === firstClaimId, 'same utterance and index must yield the same id');
  assert(firstClaimId !== secondClaimId, 'different claim indexes must not share a claim id');
});

runCase('correction removes only chat events attached to the corrected claims', () => {
  const keepMeasurement: HealthMeasurement = {
    id: 'measurement-keep',
    timestamp: '2026-09-08T10:00:00Z',
    metric: 'systolic',
    value: 130,
    unit: 'mmHg',
    source: 'chat',
    claimId: 'claim-keep',
  };
  const removeMeasurement: HealthMeasurement = {
    id: 'measurement-remove',
    timestamp: '2026-09-08T11:00:00Z',
    metric: 'systolic',
    value: 168,
    unit: 'mmHg',
    source: 'chat',
    claimId: firstClaimId,
  };
  const removeObservation: Observation = {
    id: 'observation-remove',
    date: '2026-09-08',
    source: 'chat',
    text,
    tags: ['dizziness'],
    claimId: secondClaimId,
  };
  const removed = removeCorrectedChatEvents(
    [measurementToEvent(keepMeasurement), measurementToEvent(removeMeasurement), observationToEvent(removeObservation)],
    [firstClaimId, secondClaimId],
  );

  assert(removed.length === 1, 'only unrelated chat events should remain');
  assert(
    removed[0].type === 'measurement' && removed[0].measurement.id === 'measurement-keep',
    'unrelated event must survive',
  );
});

runCase('legacy chat events without claim ids fail closed and are not guessed away', () => {
  const legacyObservation: Observation = {
    id: 'legacy-observation',
    date: '2026-09-08',
    source: 'chat',
    text: '我昨天摔了',
    tags: ['fall'],
  };
  const kept = removeCorrectedChatEvents([observationToEvent(legacyObservation)], [firstClaimId]);
  assert(kept.length === 1, 'legacy event without lineage must not be deleted by a guess');
});

runCase('family correction uses the same lineage and leaves other family events intact', () => {
  const remove: FamilyHealthEvent = {
    id: 'family-remove',
    timestamp: '2026-09-08T12:00:00Z',
    source: 'chat',
    subject: 'father',
    text: '我爸今天摔倒了',
    tags: ['fall'],
    hasHealthValue: false,
    status: 'occurred',
    visibility: 'family_ok',
    shareMode: 'persistent',
    claimId: firstClaimId,
  };
  const keep: FamilyHealthEvent = {
    ...remove,
    id: 'family-keep',
    claimId: 'claim-other',
  };
  const remaining = removeCorrectedFamilyEvents([remove, keep], [firstClaimId]);
  assert(remaining.length === 1, 'only the corrected family event must be removed');
  assert(remaining[0].id === 'family-keep', 'unrelated family event must survive');
});
