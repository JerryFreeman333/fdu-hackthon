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
