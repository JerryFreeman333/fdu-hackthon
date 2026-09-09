import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LocalHealthRecordStore } from '../src/store/LocalHealthRecordStore';
import type { HealthRecordSnapshot } from '../src/store/HealthRecordStore';

const snapshot: HealthRecordSnapshot = {
  events: [
    {
      kind: 'observation',
      id: 'event-private-1',
      timestamp: '2026-09-09T08:00:00Z',
      source: 'chat',
      data: { text: '私密健康事实' },
    },
  ],
  familyEvents: [],
  chat: [{ id: 'chat-private-1', role: 'elder', text: '胸口不舒服', time: '2026-09-09T08:00:00Z' }],
};

describe('health record session isolation', () => {
  it('keeps saved health data available only through the in-memory store', () => {
    const store = new LocalHealthRecordStore();
    store.clear();
    store.save(snapshot);

    assert.equal(store.load().events[0]?.id, 'event-private-1');
    assert.equal(store.load().chat[0]?.text, '胸口不舒服');
  });

  it('clears all session health data explicitly', () => {
    const store = new LocalHealthRecordStore();
    store.save(snapshot);
    store.clear();

    assert.deepEqual(store.load(), { events: [], familyEvents: [], chat: [] });
  });

  it('does not depend on browser persistence APIs', () => {
    const store = new LocalHealthRecordStore();
    assert.doesNotThrow(() => store.load());
    assert.doesNotThrow(() => store.save(snapshot));
    assert.doesNotThrow(() => store.clear());
  });
});
