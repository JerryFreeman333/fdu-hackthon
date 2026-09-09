import { LocalHealthRecordStore } from '../src/store/LocalHealthRecordStore';
import type { ChatMessage, FamilyHealthEvent } from '../src/types';
import type { HealthEvent } from '../src/pipeline/events';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const event: HealthEvent = {
  id: 'health-isolation-1',
  timestamp: '2026-09-09T09:00:00Z',
  source: 'chat',
  subject: 'self',
  text: '今天有一点头晕',
  tags: ['dizziness'],
  hasHealthValue: false,
  status: 'occurred',
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
  role: 'user',
  text: '今天有一点头晕',
  createdAt: '2026-09-09T09:00:00Z',
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

loaded.events[0]!.evidence.push('mutated outside store');
loaded.familyEvents[0]!.tags.push('extra');
loaded.chat[0]!.text = 'mutated outside store';
const cloned = firstSession.load();
assert(cloned.events[0]?.evidence.includes('mutated outside store') === false, 'loaded events must not expose internal mutable arrays');
assert(cloned.familyEvents[0]?.tags.includes('extra') === false, 'loaded family events must be cloned');
assert(cloned.chat[0]?.text === chat.text, 'loaded chat must be cloned');

firstSession.clear();
const cleared = firstSession.load();
assert(cleared.events.length === 0, 'clear must remove all health events');
assert(cleared.familyEvents.length === 0, 'clear must remove all family facts');
assert(cleared.chat.length === 0, 'clear must remove all chat');

console.log('PASS: session-only health store isolation and no cross-session residue');
