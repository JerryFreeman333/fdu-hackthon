import { measurementToEvent, observationToEvent, type HealthEvent } from '../src/pipeline/events';
import { runDetection } from '../src/engine/detect';
import { claimIdForMessage, removeCorrectedChatEvents } from '../src/engine/claimLineage';
import { acceptedSelfClaims, understandElderInput } from '../src/engine/understanding';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runCase(name: string, fn: () => void) {
  fn();
  console.log(`PASS: ${name}`);
}

const TODAY = '2026-09-08';

function selfObservation(text: string, claimIndex = 0): HealthEvent {
  return observationToEvent({
    id: `obs-${claimIndex}-${text}`,
    date: TODAY,
    source: 'chat',
    text,
    tags: ['fall'],
    visibility: 'family_ok',
    claimId: claimIdForMessage(text, claimIndex),
  });
}

runCase('correcting the latest utterance preserves an earlier independent event', () => {
  const firstText = '我今天上午摔了一下';
  const secondText = '我今天下午又摔了一下';
  const firstInput = understandElderInput(firstText, TODAY);
  const secondInput = understandElderInput(secondText, TODAY);

  assert(acceptedSelfClaims(firstInput).length === 1, '第一条跌倒应进入本人事实流');
  assert(acceptedSelfClaims(secondInput).length === 1, '第二条跌倒应进入本人事实流');

  const firstEvent = selfObservation(firstText);
  const secondEvent = selfObservation(secondText);
  const kept = removeCorrectedChatEvents([firstEvent, secondEvent], [claimIdForMessage(secondText, 0)]);

  assert(kept.length === 1, '更正第二条后只能留下第一条');
  const remaining = kept[0];
  assert(remaining?.type === 'observation', '保留的独立记录应该仍然是 observation');
  assert(remaining.observation.text === firstText, '第一条独立跌倒记录必须保留');
});

runCase('correcting a measurement removes the measurement lineage without deleting another reading', () => {
  const firstText = '我今天血压130';
  const secondText = '我今天血压168';
  const firstClaimId = claimIdForMessage(firstText, 0);
  const secondClaimId = claimIdForMessage(secondText, 0);

  const firstMeasurement = measurementToEvent({
    id: 'bp-first',
    timestamp: `${TODAY}T09:00:00Z`,
    metric: 'systolic',
    value: 130,
    unit: 'mmHg',
    source: 'chat',
    claimId: firstClaimId,
  });
  const secondMeasurement = measurementToEvent({
    id: 'bp-second',
    timestamp: `${TODAY}T18:00:00Z`,
    metric: 'systolic',
    value: 168,
    unit: 'mmHg',
    source: 'chat',
    claimId: secondClaimId,
  });

  const kept = removeCorrectedChatEvents([firstMeasurement, secondMeasurement], [secondClaimId]);
  assert(kept.length === 1, '更正168后应只剩130这次测量');
  const remaining = kept[0];
  assert(remaining?.type === 'measurement', '保留的独立记录应该仍然是 measurement');
  assert(remaining.measurement.value === 130, '保留的测量必须是第一条130');
});

runCase('correction changes the downstream detection state instead of leaving a ghost fall finding', () => {
  const text = '我今天摔了一下';
  const event = selfObservation(text);
  const before = runDetection([event], TODAY);
  assert(before.some((finding) => finding.ruleId === 'safety.fall'), '更正前应存在跌倒发现');

  const after = removeCorrectedChatEvents([event], [claimIdForMessage(text, 0)]);
  assert(after.length === 0, '对应 claim 的事件应全部撤销');

  const afterFindings = runDetection(after, TODAY);
  assert(!afterFindings.some((finding) => finding.ruleId === 'safety.fall'), '更正后不应遗留跌倒发现');
});
