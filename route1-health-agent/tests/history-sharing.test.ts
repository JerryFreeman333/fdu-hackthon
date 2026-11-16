import test from 'node:test';
import assert from 'node:assert/strict';
import type { HistoricalHealthEvent } from '../src/types';
import {
  buildSharedHistoricalFacts,
  createHistoricalShareGrant,
  deidentifyHistoricalText,
  isHistoricalShareGrantActive,
  sanitizeSharedHistoryPayload,
} from '../src/engine/historySharing';

const TODAY = '2026-11-15';
const LINK = 'family-link-1';

function historyEvent(overrides: Partial<HistoricalHealthEvent> = {}): HistoricalHealthEvent {
  return {
    id: 'history-1',
    eventDate: '2025-03-18',
    recordedAt: '2026-11-15T10:00:00.000Z',
    source: 'chat',
    text: '2025年3月18日我女儿李芳住在阳光小区3号楼2单元，电话13800138000，在仁爱医院住过院',
    tags: ['dyspnea'],
    hasHealthValue: false,
    status: 'occurred',
    visibility: 'private',
    sourceMessageId: 'message-1',
    ...overrides,
  };
}

test('既往事实：没有逐条授权时家属视图为空', () => {
  assert.deepEqual(buildSharedHistoricalFacts([historyEvent()], [], LINK, TODAY, ['李芳']), []);
});

test('summary_only 只给月份和结构化标签，不含原话、来源和精确日期', () => {
  const grant = createHistoricalShareGrant('history-1', 'summary_only', LINK, TODAY, `${TODAY}T10:00:00.000Z`);
  const facts = buildSharedHistoricalFacts([historyEvent()], [grant], LINK, TODAY, ['李芳']);
  assert.equal(facts.length, 1);
  const fact = facts[0]!;
  assert.equal(fact.eventMonth, '2025-03');
  assert.deepEqual(fact.tags, ['dyspnea']);
  assert.equal(fact.status, 'occurred');
  assert.equal(fact.scope, 'summary_only');
  assert.equal(fact.text, undefined);
  // 原始 eventId 形如 history-live-<Date.now()>-0；对外 id 不能把录入时间送出去。
  assert.notEqual(fact.id, 'history-1');
  assert.equal(fact.id, grant.publicId);
  const serialized = JSON.stringify(facts);
  assert.doesNotMatch(serialized, /2025-03-18/);
  assert.doesNotMatch(serialized, /sourceMessageId|recordedAt|visibility|message-1/);
  assert.doesNotMatch(serialized, /李芳|13800138000|阳光小区|仁爱医院/);
});

test('summary_with_text 对姓名、手机号、住址和医疗机构做脱敏并截断', () => {
  const longText = `${historyEvent().text}${'补充'.repeat(150)}`;
  const grant = createHistoricalShareGrant('history-1', 'summary_with_text', LINK, TODAY, `${TODAY}T10:05:00.000Z`);
  const facts = buildSharedHistoricalFacts([historyEvent({ text: longText })], [grant], LINK, TODAY, ['李芳']);
  const text = facts[0]?.text ?? '';
  assert.doesNotMatch(text, /李芳|13800138000|阳光小区|3号楼|仁爱医院|2025年3月18日/);
  assert.match(text, /家人/);
  assert.match(text, /\[手机号已隐藏\]/);
  assert.match(text, /\[住址已隐藏\]/);
  assert.match(text, /\[医疗机构已隐藏\]/);
  assert.match(text, /2025年3月/);
  assert.match(text, /原话已截断/);
  assert.ok(text.length <= 220);
});

test('撤回、到期、换绑后的授权一律失效', () => {
  const active = createHistoricalShareGrant('history-1', 'summary_only', LINK, TODAY, `${TODAY}T10:00:00.000Z`);
  const revoked = { ...active, revokedAt: `${TODAY}T10:01:00.000Z` };
  const expired = { ...active, expiresAt: '2026-11-14' };
  const otherLink = { ...active, familyLinkId: 'other-link' };
  assert.equal(isHistoricalShareGrantActive(active, TODAY), true);
  assert.equal(isHistoricalShareGrantActive(revoked, TODAY), false);
  assert.equal(isHistoricalShareGrantActive(expired, TODAY), false);
  assert.deepEqual(buildSharedHistoricalFacts([historyEvent()], [revoked], LINK, TODAY, ['李芳']), []);
  assert.deepEqual(buildSharedHistoricalFacts([historyEvent()], [expired], LINK, TODAY, ['李芳']), []);
  assert.deepEqual(buildSharedHistoricalFacts([historyEvent()], [otherLink], LINK, TODAY, ['李芳']), []);
});

test('有效期含授权日共七个日历日，到期次日不再可见', () => {
  const grant = createHistoricalShareGrant('history-1', 'summary_only', LINK, TODAY, `${TODAY}T10:00:00Z`);
  assert.equal(grant.expiresAt, '2026-11-21');
  assert.equal(isHistoricalShareGrantActive(grant, '2026-11-21'), true);
  assert.equal(isHistoricalShareGrantActive(grant, '2026-11-22'), false);
});

test('补充脱敏词只保存在本地授权，对外标识不由事件时间计算', () => {
  const event = historyEvent({ id: 'history-live-1757900000000-0', text: '去年陈小云陪我就医，电话+86 138-0013-8000' });
  const grant = createHistoricalShareGrant(event.id, 'summary_with_text', LINK, TODAY, `${TODAY}T10:00:00Z`, [
    '陈小云',
  ]);
  const facts = buildSharedHistoricalFacts([event], [grant], LINK, TODAY);
  assert.doesNotMatch(JSON.stringify(facts), /陈小云|138-0013-8000|1757900000000|redactions/);
  assert.equal(facts[0]?.id, grant.publicId);
  assert.deepEqual(facts, buildSharedHistoricalFacts([event], [grant], LINK, TODAY));
  const renewed = createHistoricalShareGrant(event.id, 'summary_with_text', LINK, TODAY, `${TODAY}T11:00:00Z`);
  assert.notEqual(renewed.publicId, grant.publicId);
});

test('跨端校验拒绝伪造日期与原型属性标签', () => {
  const base = {
    id: 'test',
    eventMonth: '2025-03',
    tags: ['constructor', '__proto__', 'dyspnea'],
    status: 'occurred',
    scope: 'summary_only',
    expiresAt: '2026-11-21',
  };
  assert.deepEqual(sanitizeSharedHistoryPayload([{ ...base, eventMonth: '2025-13' }]), []);
  assert.deepEqual(sanitizeSharedHistoryPayload([{ ...base, expiresAt: '2026-02-31' }]), []);
  assert.deepEqual(sanitizeSharedHistoryPayload([base])[0]?.tags, ['dyspnea']);
});

test('脱敏函数即使没有姓名列表，也不放过手机号/证件号/门牌/邮箱/精确日期', () => {
  const text = deidentifyHistoricalText(
    '身份证110101199001011234，卡号6222021234567890123，住3号楼2单元，邮箱li.fang@example.com，2025年3月18日住院',
  );
  assert.doesNotMatch(text, /110101199001011234|6222021234567890123|3号楼|2单元/);
  assert.doesNotMatch(text, /li\.fang@example\.com|3月18日/);
  assert.match(text, /\[证件号已隐藏\]/);
  assert.match(text, /\[卡号已隐藏\]/);
  assert.match(text, /\[门牌已隐藏\]/);
  assert.match(text, /\[邮箱已隐藏\]/);
  assert.match(text, /2025年3月/);
});

test('跨端载荷校验：丢弃非法结构，summary_only 即使带原话也必须丢掉', () => {
  const cleaned = sanitizeSharedHistoryPayload([
    {
      id: 'history-1',
      eventMonth: '2025-03',
      tags: ['dyspnea', 'unknown-tag'],
      status: 'occurred',
      scope: 'summary_only',
      expiresAt: '2026-11-22',
      text: '不应出现的原话 13800138000',
    },
    { id: 'bad', eventMonth: '2025/03', tags: [], status: 'occurred', scope: 'summary_only', expiresAt: TODAY },
    { nope: true },
  ]);
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0]?.text, undefined);
  assert.deepEqual(cleaned[0]?.tags, ['dyspnea']);
  assert.doesNotMatch(JSON.stringify(cleaned), /不应出现|13800138000/);
});
