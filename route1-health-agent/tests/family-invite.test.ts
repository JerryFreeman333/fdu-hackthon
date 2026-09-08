import assert from 'node:assert/strict';
import {
  bindLocalInvite,
  normalizeInviteCode,
  INVITE_PREFIX,
  FAMILY_LINK_KEY,
  DEMO_ELDER_ID,
} from '../src/engine/familyInvite';

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    values.set(key, value);
  },
};
values.set(`${INVITE_PREFIX}AN-2026-0123`, JSON.stringify({ elderId: DEMO_ELDER_ID, relation: '家属' }));
for (const input of ['AN-2026-0123', ' an – 2026 — 0123 ', 'ＡＮ－２０２６－０１２３', 'an20260123']) {
  assert.equal(normalizeInviteCode(input), 'AN-2026-0123');
  assert.equal(bindLocalInvite(storage, input).status, 'active');
  assert.equal(JSON.parse(storage.getItem(FAMILY_LINK_KEY)!).inviteCode, 'AN-2026-0123');
}
assert.throws(() => bindLocalInvite(storage, '0123'), /完整邀请码/);
assert.throws(() => bindLocalInvite(storage, 'AN-2026-9999'), /同一浏览器/);
values.set(`${INVITE_PREFIX}AN-2026-0123`, 'null');
assert.throws(() => bindLocalInvite(storage, 'AN-2026-0123'), /记录不匹配/);
assert.throws(
  () =>
    bindLocalInvite(
      {
        ...storage,
        getItem: () => {
          throw new Error();
        },
      },
      'AN-2026-0123',
    ),
  /无法读取/,
);
values.set(`${INVITE_PREFIX}AN-2026-0123`, JSON.stringify({ elderId: DEMO_ELDER_ID }));
assert.throws(
  () =>
    bindLocalInvite(
      {
        ...storage,
        setItem: () => {
          throw new Error();
        },
      },
      'AN-2026-0123',
    ),
  /未能保存/,
);
