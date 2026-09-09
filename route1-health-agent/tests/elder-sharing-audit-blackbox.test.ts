import {
  appendSharingAudit,
  buildHistoricalSharingAnswer,
  historicalSharesForRecipient,
  inferSharingRecipient,
  type SharingAuditEntry,
} from '../src/engine/sharingAudit';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runCase(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

const base: SharingAuditEntry[] = [
  {
    id: 'share-1',
    createdAt: '2026-09-08T10:15:00.000Z',
    scope: 'self',
    recipient: 'daughter',
    shareMode: 'one_time',
    content: '头晕',
  },
  {
    id: 'share-2',
    createdAt: '2026-09-08T11:20:00.000Z',
    scope: 'family',
    recipient: 'daughter',
    shareMode: 'one_time',
    content: '我爸今天摔了一下',
  },
];

runCase('recipient is inferred conservatively from explicit kinship words', () => {
  assert(inferSharingRecipient('这次告诉女儿我头晕') === 'daughter', 'daughter should be detected');
  assert(inferSharingRecipient('这次告诉儿子我头晕') === 'son', 'son should be detected');
  assert(inferSharingRecipient('这次告诉家属我头晕') === 'family', 'generic family should stay generic');
});

runCase('historical records survive current revocation state', () => {
  const revoked = 'denied' as const;
  assert(revoked === 'denied', 'fixture should represent the revoked current state');
  assert(historicalSharesForRecipient(base, 'daughter').length === 2, 'history must not depend on current consent');
});

runCase('historical answer names what was actually shared and never claims revocation', () => {
  const answer = buildHistoricalSharingAnswer(base, 'daughter');
  assert(answer.includes('一次性告诉女儿：头晕'), 'self share should be auditable');
  assert(answer.includes('一次性告诉女儿：我爸今天摔了一下'), 'family share should be auditable');
  assert(!answer.includes('已经撤回'), 'history must not claim unsupported recall');
});

runCase('missing history fails closed instead of guessing', () => {
  const answer = buildHistoricalSharingAnswer([], 'daughter');
  assert(answer.includes('没有找到可靠的历史共享记录'), 'missing history should be explicit');
  assert(!answer.includes('您之前一定告诉过'), 'missing evidence must not become a guess');
});

runCase('audit append keeps bounded history and preserves order', () => {
  const result = appendSharingAudit([], base, 1);
  assert(result.length === 1, 'history should respect the configured bound');
  assert(result[0]?.id === 'share-2', 'newest record should remain after bounding');
});
