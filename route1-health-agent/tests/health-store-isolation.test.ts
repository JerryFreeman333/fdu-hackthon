import { LocalHealthRecordStore } from '../src/store/LocalHealthRecordStore';
import type { ChatMessage, FamilyHealthEvent } from '../src/types';
import type { HealthEvent } from '../src/pipeline/events';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const event: HealthEvent = {
  id: 'observation:health-isolation-1',
  type: 'observation',
  timestamp: '2026-09-09T09:00:00Z',
  source: 'chat',
  observation: {
    id: 'health-isolation-1',
    date: '2026-09-09',
    source: 'chat',
    text: '今天有一点头晕',
    tags: ['dizziness'],
  },
};

const familyEvent: FamilyHealthEvent = {
  id: 'family-isolation-1',
  timestamp: '2026-09-09T09:01:00Z',
  source: 'chat',
  subject: 'father',
  text: '我爸今天走路不稳',
  tags: ['fall'],
  hasHealthValue: false,
  status: 'occurred',
  visibility: 'family_ok',
  shareMode: 'persistent',
};

const chat: ChatMessage = {
  id: 'chat-isolation-1',
  role: 'elder',
  text: '今天有一点头晕',
  time: '09:00',
};

const firstSession = new LocalHealthRecordStore();
firstSession.save({ events: [event], familyEvents: [familyEvent], chat: [chat] });
const loaded = firstSession.load();
assert(loaded.events.length === 1, 'the same in-memory session must retain health events');
assert(loaded.familyEvents.length === 1, 'the same in-memory session must retain family facts');
assert(loaded.chat.length === 1, 'the same in-memory session must retain chat');

const secondSession = new LocalHealthRecordStore();
const fresh = secondSession.load();
assert(fresh.events.length === 0, 'a fresh store instance must not inherit prior health events');
assert(fresh.familyEvents.length === 0, 'a fresh store instance must not inherit prior family facts');
assert(fresh.chat.length === 0, 'a fresh store instance must not inherit prior chat');

const loadedObservation = loaded.events[0];
assert(loadedObservation?.type === 'observation', 'fixture must remain an observation event');
loadedObservation.observation.text = 'mutated outside store';
loadedObservation.observation.tags.push('pain');
loaded.familyEvents[0]!.tags.push('pain');
loaded.chat[0]!.text = 'mutated outside store';
const cloned = firstSession.load();
const clonedObservation = cloned.events[0];
assert(clonedObservation?.type === 'observation', 'cloned fixture must remain an observation event');
assert(clonedObservation.observation.text === event.observation.text, 'loaded observations must be cloned');
assert(clonedObservation.observation.tags.includes('pain') === false, 'loaded observation tags must not be shared');
assert(cloned.familyEvents[0]?.tags.includes('pain') === false, 'loaded family events must be cloned');
assert(cloned.chat[0]?.text === chat.text, 'loaded chat must be cloned');

firstSession.clear();
const cleared = firstSession.load();
assert(cleared.events.length === 0, 'clear must remove all health events');
assert(cleared.familyEvents.length === 0, 'clear must remove all family facts');
assert(cleared.chat.length === 0, 'clear must remove all chat');

console.log('PASS: session-only health store isolation and no cross-session residue');
