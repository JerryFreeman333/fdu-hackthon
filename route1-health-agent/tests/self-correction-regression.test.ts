import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage, FamilyHealthEvent, HealthMeasurement, Observation } from '../src/types';
import { measurementToEvent, observationToEvent, type HealthEvent } from '../src/pipeline/events';
import { removeCorrectedChatHealthEvents, removeCorrectedFamilyEvents } from '../src/engine/correction';
import { understandElderInput } from '../src/engine/understanding';

const TODAY = '2026-09-10';

function elderMessage(id: string, text: string): ChatMessage {
  return { id, role: 'elder', text, time: '09-10 10:00' };
}

function observation(id: string, sourceMessageId: string, text: string, tags: Observation['tags']): Observation {
  return {
    id,
    date: TODAY,
    source: 'chat',
    text,
    tags,
    metadata: { sourceMessageId },
  };
}

function measurement(
  id: string,
  sourceMessageId: string,
  metric: HealthMeasurement['metric'],
  value: number,
): HealthMeasurement {
  return {
    id,
    timestamp: `${TODAY}T10:00:00`,
    metric,
    value,
    unit: metric === 'systolic' ? 'mmHg' : 'bpm',
    source: 'chat',
    metadata: { sourceMessageId, sourceText: `${value}` },
  };
}

test('correction targets the immediately previous elder turn', () => {
  const chat = [elderMessage('elder-001', '我今天摔倒了')];
  const understanding = understandElderInput('说错了，不是我，是我老公', TODAY, chat);

  assert.equal(understanding.correction, true);
  assert.equal(understanding.correctionTargetMessageId, 'elder-001');
  assert.equal(understanding.claims[0]?.subject, 'spouse');
});

test('correction removes only facts owned by the corrected message, not same-tag facts', () => {
  const olderObservation = observation('obs-older', 'elder-001', '我今天喘了一下', ['dyspnea']);
  const correctedObservation = observation('obs-corrected', 'elder-002', '我刚才也喘了', ['dyspnea']);
  const olderMeasurement = measurement('hr-older', 'elder-001', 'restingHr', 88);
  const correctedMeasurement = measurement('hr-corrected', 'elder-002', 'restingHr', 92);
  const unrelatedImported = observation('obs-demo', 'not-a-chat-message', '历史喘息记录', ['dyspnea']);
  const events: HealthEvent[] = [
    observationToEvent(olderObservation),
    measurementToEvent(olderMeasurement),
    observationToEvent(correctedObservation),
    measurementToEvent(correctedMeasurement),
    observationToEvent({ ...unrelatedImported, source: 'demo' }),
  ];

  const next = removeCorrectedChatHealthEvents(events, 'elder-002');
  const ids = next.map((event) => event.id);

  assert.deepEqual(ids, ['observation:obs-older', 'measurement:hr-older', 'observation:obs-demo']);
});

test('correction removes all derived facts from the corrected turn together', () => {
  const events: HealthEvent[] = [
    observationToEvent(observation('obs-1', 'elder-002', '我今天胸闷', ['chestPain'])),
    measurementToEvent(measurement('bp-sys-1', 'elder-002', 'systolic', 180)),
    measurementToEvent(measurement('bp-dia-1', 'elder-002', 'diastolic', 110)),
  ];

  const next = removeCorrectedChatHealthEvents(events, 'elder-002');
  assert.equal(next.length, 0);
});

test('family correction uses exact source message provenance instead of subject + tag matching', () => {
  const familyEvents: FamilyHealthEvent[] = [
    {
      id: 'family-older',
      timestamp: `${TODAY}T09:00:00`,
      source: 'chat',
      subject: 'spouse',
      text: '我老公走路不稳',
      tags: ['fall'],
      hasHealthValue: false,
      status: 'occurred',
      visibility: 'private',
      shareMode: 'private',
      sourceMessageId: 'elder-001',
    },
    {
      id: 'family-corrected',
      timestamp: `${TODAY}T10:00:00`,
      source: 'chat',
      subject: 'spouse',
      text: '我老公刚才摔了一跤',
      tags: ['fall'],
      hasHealthValue: false,
      status: 'occurred',
      visibility: 'private',
      shareMode: 'private',
      sourceMessageId: 'elder-002',
    },
  ];

  const next = removeCorrectedFamilyEvents(familyEvents, 'elder-002');
  assert.deepEqual(
    next.map((event) => event.id),
    ['family-older'],
  );
});

test('missing provenance fails closed and deletes nothing', () => {
  const legacy = observationToEvent({
    id: 'legacy-observation',
    date: TODAY,
    source: 'chat',
    text: '老的聊天健康记录',
    tags: ['dyspnea'],
  });

  const next = removeCorrectedChatHealthEvents([legacy], 'elder-002');
  assert.equal(next.length, 1);
  assert.equal(next[0]?.id, 'observation:legacy-observation');
});

// === Issue ⑤ regression: targetTags 让"撤销其中一项"只删对应症状 ===
test('issue ⑤: correction with targetTags removes only the negated symptom, keeps other co-occurring facts', () => {
  // 场景：上一句"我头晕，血压150/90"。用户说"刚才说错了，没有头晕"。
  // 期望：删头晕 observation，保留 150/90 measurement（issue ⑤ 的核心场景）。
  const events: HealthEvent[] = [
    observationToEvent(observation('obs-dizzy', 'elder-001', '我头晕', ['dizziness'])),
    measurementToEvent(measurement('bp-sys-1', 'elder-001', 'systolic', 150)),
    measurementToEvent(measurement('bp-dia-1', 'elder-001', 'diastolic', 90)),
    observationToEvent(observation('obs-other', 'elder-002', '我胸痛', ['chestPain'])),
  ];

  const next = removeCorrectedChatHealthEvents(events, 'elder-001', ['dizziness']);
  const ids = next.map((event) => event.id);
  // 头晕 observation 删；150/90 两条 measurement 留；elder-002 的胸痛留
  assert.deepEqual(ids, ['measurement:bp-sys-1', 'measurement:bp-dia-1', 'observation:obs-other']);
});

test('issue ⑤: correction with targetTags=["bpHigh"] removes only blood pressure measurements', () => {
  // 场景：用户说"刚才说错了，血压没那么高"。targetTags 包含 bpHigh，删血压，保留头晕。
  const events: HealthEvent[] = [
    observationToEvent(observation('obs-dizzy', 'elder-001', '我头晕', ['dizziness'])),
    measurementToEvent(measurement('bp-sys-1', 'elder-001', 'systolic', 150)),
    measurementToEvent(measurement('bp-dia-1', 'elder-001', 'diastolic', 90)),
  ];

  const next = removeCorrectedChatHealthEvents(events, 'elder-001', ['bpHigh']);
  // 血压 measurement 删；头晕 observation 留
  assert.equal(next.length, 1);
  assert.equal(next[0]?.id, 'observation:obs-dizzy');
});

test('issue ⑤: correction with empty targetTags preserves old behavior (delete the whole message)', () => {
  // 兜底：targetTags 空数组 = 旧行为，整条删除 sourceMessageId 匹配的所有事件。
  const events: HealthEvent[] = [
    observationToEvent(observation('obs-1', 'elder-001', '我头晕', ['dizziness'])),
    measurementToEvent(measurement('bp-sys-1', 'elder-001', 'systolic', 150)),
  ];

  const next = removeCorrectedChatHealthEvents(events, 'elder-001', []);
  assert.equal(next.length, 0);
});

test('issue ⑤: understandElderInput surfaces correctionTargetTags in the correction branch', () => {
  const chat = [elderMessage('elder-001', '我今天头晕')];
  const u = understandElderInput('刚才说错了，没有头晕', TODAY, chat);
  assert.equal(u.correction, true);
  assert.equal(u.correctionTargetMessageId, 'elder-001');
  assert.deepEqual(u.correctionTargetTags, ['dizziness']);
});

test('issue ⑤: correctionTargetTags is empty when the correction text has no specific tags', () => {
  // 用户只说"刚才说错了"，没说哪条——targetTags 应为空，走整条删除兜底。
  const chat = [elderMessage('elder-001', '我今天头晕')];
  const u = understandElderInput('刚才说错了', TODAY, chat);
  assert.equal(u.correction, true);
  assert.equal(u.correctionTargetMessageId, 'elder-001');
  assert.deepEqual(u.correctionTargetTags ?? [], []);
});

// Final verification marker: correction provenance regression suite.
