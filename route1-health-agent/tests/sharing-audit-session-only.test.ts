import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearSharingAudit,
  loadSharingAudit,
  recordSharingAudit,
  type SharingAuditEntry,
} from '../src/engine/sharingAudit';

const base: SharingAuditEntry = {
  id: 'audit-session-1',
  createdAt: '2026-09-09T10:00:00.000Z',
  scope: 'self',
  recipient: 'daughter',
  shareMode: 'one_time',
  content: '胸闷，已经告诉女儿',
};

afterEach(() => {
  clearSharingAudit();
  delete (globalThis as { window?: unknown }).window;
});

describe('sharing audit session-only privacy', () => {
  it('records history inside the current session without browser persistence', () => {
    recordSharingAudit([base]);
    assert.deepEqual(loadSharingAudit(), [base]);
  });

  it('does not restore an old persisted audit record', () => {
    const storage = new Map<string, string>([['ankang-route1-sharing-audit-v1', JSON.stringify([base])]]);
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => storage.delete(key),
        setItem: () => {
          throw new Error('sharing audit must not write to localStorage');
        },
      },
    };

    assert.deepEqual(loadSharingAudit(), []);
    assert.equal(storage.has('ankang-route1-sharing-audit-v1'), false);
  });

  it('keeps historical sharing answers available during the same session', () => {
    recordSharingAudit([base]);
    const entries = loadSharingAudit();
    assert.equal(entries[0]?.content, base.content);
    assert.equal(entries[0]?.recipient, 'daughter');
  });
});
