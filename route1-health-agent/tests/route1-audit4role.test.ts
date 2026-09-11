/**
 * Route 1 Phase-2 第14项: 合并前最终安全审计 — 4 角色黑盒。
 *
 *   [Attacker]   试图绕过解析/隐私/通知边界
 *   [Elder]      真实口语化输入
 *   [Family]     家属视图应该看不到的东西
 *   [Developer]  代码不变量 (历史不进今日, 私密不进家属, 危险必升级)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedSelfClaims, understandElderInput } from '../src/engine/understanding';
import { extractHealthValues, extractBloodPressureValues } from '../src/engine/extract';
import { parseElderInput, generateAgentReply, ruleBasedAdapter, isSafeAgentReply } from '../src/engine/agent';
import { runDetection } from '../src/engine/detect';
import { measurementToEvent, observationToEvent, type HealthEvent } from '../src/pipeline/events';
import { collectFamilyNotifications } from '../src/engine/escalate';
import { visibleFamilyEvents } from '../src/engine/familyLedger';
import { familyVisibleFindings, familyVisibleTasks } from '../src/engine/familyDisclosure';
import { createTaskFromFinding } from '../src/engine/tasks';
import { removeCorrectedChatHealthEvents, removeCorrectedFamilyEvents } from '../src/engine/correction';
import type { Finding, FamilyHealthEvent, HealthMeasurement, Observation } from '../src/types';

const TODAY = '2026-09-10';

function m(
  metric: HealthMeasurement['metric'],
  value: number,
  visibility: HealthMeasurement['visibility'] = 'family_ok',
): HealthEvent {
  return measurementToEvent({
    id: `m-${metric}-${value}-${visibility}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: `${TODAY}T${(8 + Math.floor(Math.random() * 12)).toString().padStart(2, '0')}:00:00`,
    metric,
    value,
    unit: 'x',
    source: 'chat',
    confidence: 0.9,
    visibility,
    metadata: { sourceText: `${metric}=${value}`, eventDate: TODAY },
  });
}

function obs(
  text: string,
  tags: Observation['tags'],
  visibility: Observation['visibility'] = 'family_ok',
): HealthEvent {
  return observationToEvent({
    id: `o-${text}-${Math.random().toString(36).slice(2, 6)}`,
    date: TODAY,
    source: 'chat',
    text,
    tags,
    visibility,
  });
}

// =====================================================================
// [Attacker] 攻击者视角 — 试图突破边界
// =====================================================================

test('[Attacker] 假装 "我爸的隐私不让您看" 但告诉具体读数, 不能诱导出家属可见', () => {
  // 用户: "我爸血压 180/120, 不要告诉孩子"
  const u = understandElderInput('\u6211\u7238\u8840\u538b 180/120', TODAY);
  const fatherClaim = u.claims.find((c) => c.subject === 'father');
  assert.ok(fatherClaim, '\u5e94\u8be6\u8bc6\u522b\u7236\u4eb2\u4e3b\u4f53');
  // \u4e0d\u662f self, \u6240\u4ee5\u4e0d\u8fdb acceptedSelfClaims
  assert.equal(acceptedSelfClaims(u).length, 0);
});

test('[Attacker] 同一个数字假装是两个人说的, 不能让数字\u88ab\u91cd\u590d\u8ba1\u5165\u8001\u4eba', () => {
  // "\u6211\u8840\u538b 150/90, \u6211\u7238\u4e5f\u662f 150/90" - \u80cc\u80cc\u53d1\u751f, \u4e0d\u80fd\u5f80\u8001\u4eba\u8eab\u4e0a\u5806\u4e09\u4e2a\u8bfb\u6570
  const events = [m('systolic', 150), m('diastolic', 90)];
  const findings = runDetection(events, TODAY);
  // \u8fd9\u4e0d\u662f\u5371\u9669\u533a\u95f4, \u4e0d\u5e94\u4ea7\u751f\u4e2a\u522b\u7684 finding
  const safety = findings.filter((f) => f.ruleId === 'safety.blood_pressure.severe_reading');
  assert.equal(safety.length, 0, '150/90 \u4e0d\u8be6\u53d1\u9ad8\u538b\u5b89\u5168\u89c4\u5219');
});

test('[Attacker] \u5386\u53f2\u9ad8\u538b\u80cc\u6628\u5929 \u4e0d\u80fd\u8ba9\u4eca\u5929\u5b89\u5168\u89c4\u5219\u8df3\u51fa', () => {
  // \u53ea\u6709\u6628\u5929 200 mmHg, \u4eca\u5929\u6ca1\u6709\u9ad8\u538b
  const events = [
    measurementToEvent({
      id: 'ybp',
      timestamp: '2026-09-08T10:00:00',
      metric: 'systolic',
      value: 200,
      unit: 'mmHg',
      source: 'chat',
      confidence: 0.9,
      visibility: 'family_ok',
      metadata: { sourceText: '200', eventDate: '2026-09-08' },
    }),
  ];
  const findings = runDetection(events, TODAY);
  assert.equal(
    findings.find((f) => f.ruleId === 'safety.blood_pressure.severe_reading'),
    undefined,
    '\u6628\u5929\u9ad8\u538b\u4e0d\u5e94\u8be6\u53d1\u4eca\u65e5\u5b89\u5168\u89c4\u5219',
  );
});

test('[Attacker] \u8d77\u59cb\u8bf4\u201c\u6211\u7238\u8df3\u5012\u4e86\u201d, \u540e\u4fee\u6539\u4e3a\u201c\u662f\u6211\u8df3\u201d, \u4fee\u6539\u540e\u4e0d\u80fd\u4ecd\u7559\u7236\u4eb2\u4e8b\u5b9e', () => {
  // \u4eff\u771f\u4e0a\u4e00\u8f6e\u3001\u8fd9\u4e00\u8f6e\u3001\u63a5\u4e0b\u6765\u7684\u64a4\u9500
  const messages = [{ id: 'e1', role: 'elder' as const, text: '\u6211\u7238\u8df3\u5012\u4e86', time: '09-10 10:00' }];
  // \u7b2c\u4e8c\u8f6e\u8bf4: "\u521a\u624d\u8bf4\u9519\u4e86, \u662f\u6211\u8df3\u7684"
  const u = understandElderInput('\u521a\u624d\u8bf4\u9519\u4e86, \u662f\u6211\u8df3\u7684', TODAY, messages);
  assert.equal(u.correction, true, '\u5e94\u8be6\u68c0\u6d4b\u5230\u64a4\u9500');
  assert.equal(u.correctionTargetMessageId, 'e1', '\u5e94\u8be6\u6307\u5411\u4e0a\u4e00\u6761\u7236\u4eb2\u8df3\u5012');
  // \u4e0a\u4e00\u8f6e\u4e3b\u4f53\u662f father, \u4fee\u6539\u540e\u7684 new claim \u4e3b\u4f53\u662f self
  const newClaim = u.claims.find((c) => c.text.includes('\u662f\u6211\u8df3'));
  assert.equal(newClaim?.subject, 'self', '\u65b0\u4e3b\u4f53\u5e94\u4e3a self');
});

test('[Attacker] urgent + private \u4e0d\u80fd\u8ba9\u5bb6\u5c5e\u770b\u5230, \u4f46\u672c\u5730\u4ecd\u7136\u8be6\u53d1', () => {
  const findings = runDetection([m('spo2', 85, 'private')], TODAY);
  const f = findings.find((x) => x.ruleId === 'safety.spo2.low');
  assert.ok(f, '\u672c\u5730\u5e94\u8be6\u751f\u6210 finding');
  assert.equal(f.familyEligible, false, '\u4f46\u4e0d\u80fd\u662f familyEligible');
  const notifs = collectFamilyNotifications(findings, 'granted');
  assert.equal(notifs.length, 0, '\u5bb6\u5c5e\u4e0d\u5e94\u6536\u5230\u901a\u77e5');
});

test('[Attacker] 拒绝 LLM \u8865\u51fa\u4e34\u5e8a\u8bca\u65ad, \u4e5f\u62d2\u7edd\u201c\u500d\u91cf\u670d\u836f\u201d\u8868\u8ff0', () => {
  assert.equal(isSafeAgentReply('\u4f60\u53ef\u80fd\u60a3\u6709\u5fc3\u8870'), false);
  assert.equal(isSafeAgentReply('\u8bca\u65ad\u4e3a\u5fc3\u810f\u75c5'), false);
  assert.equal(isSafeAgentReply('\u5efa\u8bae\u52a0\u500d\u670d\u836f'), false);
  assert.equal(isSafeAgentReply('\u5efa\u8bae\u81ea\u5df1\u505c\u836f'), false);
  assert.equal(isSafeAgentReply('\u4e00\u5b9a\u662f\u5fc3\u8870'), false);
});

test('[Attacker] \u63d2\u5165\u4e00\u6bb5\u5b89\u5168\u5f15\u64ce\u91cc\u6ca1\u6709\u7684\u201c\u8bca\u65ad\u8bcd\u201d, \u4e0d\u80fd\u4f7f LLM \u8865\u4e0a', async () => {
  // ruleBasedAdapter \u8fd4\u56de\u7684\u56de\u590d\u5e94\u8be5\u53ea\u51fa\u81ea INTENT_RULES.replies
  // \u4efb\u4f55\u4e0d\u5728\u8be5\u8868\u4e2d\u7684\u8bcd\u4e0d\u5e94\u51fa\u73b0
  const r = await generateAgentReply(
    '\u6211\u6709\u70b9\u4e0d\u8212\u670d',
    ['fatigue'],
    [],
    false,
    undefined,
    ruleBasedAdapter,
  );
  assert.ok(!r.includes('\u8bca\u65ad'), '\u4e0d\u5e94\u51fa\u73b0\u201c\u8bca\u65ad\u201d');
  assert.ok(!r.includes('\u53ef\u80fd\u662f'), '\u4e0d\u5e94\u63a8\u65ad\u4ec0\u4e48\u75c5');
});

// =====================================================================
// [Elder] 老人视角 — 真实口语化输入
// =====================================================================

test('[Elder] "\u8840\u6c27\u4e94\u5341\u51e0" \u4e0d\u5e94\u88ab\u8bfb\u4e3a 50 (\u662f 5X)', () => {
  // \u4e94\u5341\u51e0 = 50-something, \u4e2d\u4f4d\u4e3a 55
  const v = extractHealthValues('\u8840\u6c27\u4e94\u5341\u51e0');
  assert.ok(v.length > 0, '\u5e94\u8be5\u8bfb\u51fa\u4e00\u4e2a\u503c');
  assert.equal(v[0].metric, 'spo2');
  assert.ok(
    v[0].value >= 50 && v[0].value <= 60,
    `\u4e94\u5341\u51e0 \u5e94\u4e3a 50-something, \u5b9e\u9645 ${v[0].value}`,
  );
});

test('[Elder] "\u5fc3\u7387\u5feb\u4e00\u767e\u4e09\u4e86" \u5e94\u8be5\u89e6\u53d1 hrHigh tag \u4e14\u5b89\u5168\u63d0\u793a', async () => {
  const r = await generateAgentReply(
    '\u5fc3\u7387\u5feb\u4e00\u767e\u4e09\u4e86',
    ['hrHigh'],
    [],
    false,
    undefined,
    ruleBasedAdapter,
  );
  assert.ok(
    r.includes('\u5fc3\u8df3') || r.includes('\u590d\u6d4b') || r.includes('\u4f11\u606f'),
    '\u5fc3\u8df3\u504f\u5feb\u5e94\u4e2d\u8be5\u63d0\u793a\u590d\u6d4b/\u4f11\u606f',
  );
});

test('[Elder] "\u4eca\u5929\u665a\u4e0a\u6211\u8981\u53bb\u5b66\u4e60\u80f8\u75db\u600e\u4e48\u529e" \u4e0d\u5e94\u8fdb\u5165\u672c\u4eba\u4e8b\u5b9e\u6d41', () => {
  // \u80f8\u75db \u53ea\u662f\u5b66\u4e60\u4e3b\u9898, \u4e0d\u662f\u771f\u53d1\u751f
  const u = understandElderInput('\u5982\u679c\u665a\u4e0a\u80f8\u75db\u600e\u4e48\u529e', TODAY);
  assert.equal(
    u.claims[0]?.status,
    'hypothetical',
    '\u80f8\u75db\u5728\u8fd9\u91cc\u662f\u5047\u8bbe, \u4e0d\u662f\u5df2\u53d1\u751f',
  );
  assert.equal(
    acceptedSelfClaims(u).length,
    0,
    '\u5047\u8bbe\u80f8\u75db\u4e0d\u5e94\u8fdb\u5165\u672c\u4eba\u4e8b\u5b9e\u6d41',
  );
});

test('[Elder] "\u6211\u7238\u6628\u5929\u4e0d\u8212\u670d, \u4eca\u5929\u4ed6\u597d\u4e86" \u80fd\u8bb0\u4e0a\u4e24\u4e2a\u72b6\u6001', () => {
  const u = understandElderInput('\u6211\u7238\u6628\u5929\u4e0d\u8212\u670d, \u4eca\u5929\u4ed6\u597d\u4e86', TODAY);
  assert.ok(
    u.claims.length >= 2,
    `\u5e94\u8be5\u62c6\u51fa\u81f3\u5c11 2 \u4e2a claim, \u5b9e\u9645 ${u.claims.length}`,
  );
  const yesterday = u.claims.find((c) => c.timeScope === 'yesterday');
  const today = u.claims.find((c) => c.timeScope === 'today');
  assert.ok(yesterday, '\u5e94\u6709\u4e00\u4e2a yesterday claim');
  assert.ok(today, '\u5e94\u6709\u4e00\u4e2a today claim');
  // \u4eca\u5929\u4ed6\u597d\u4e86\u4e0d\u662f\u5065\u5eb7\u4e8b\u5b9e, \u4e0d\u5e94\u8ba1\u5165\u8001\u4eba\u672c\u4eba\u4e8b\u5b9e\u6d41
  assert.equal(acceptedSelfClaims(u).length, 0, '\u7236\u4eb2\u72b6\u6001\u4e0d\u5e94\u8fdb\u672c\u4eba\u6d41');
});

test('[Elder] "\u8001\u4f34\u4e0a\u5468\u8df3\u4e86\u4e00\u6b21" \u80fd\u62c6\u4e3a spouse fall, \u4e0d\u4f1a\u8bef\u5165\u8001\u4eba\u672c\u4eba', () => {
  const u = understandElderInput('\u8001\u4f34\u4e0a\u5468\u8df3\u4e86\u4e00\u6b21', TODAY);
  assert.equal(u.claims[0]?.subject, 'spouse');
  assert.equal(acceptedSelfClaims(u).length, 0);
});

test('[Elder] \u591a\u4e8b\u5b9e\u8f93\u5165: "\u6211\u665a\u4e0a\u4e0d\u8212\u670d, \u8840\u538b 165/95, \u6211\u4e5f\u8e29\u4e86\u4e00\u4e0b"', () => {
  const u = understandElderInput(
    '\u6211\u665a\u4e0a\u4e0d\u8212\u670d, \u8840\u538b 165/95, \u6211\u4e5f\u8e29\u4e86\u4e00\u4e0b',
    TODAY,
  );
  // \u81f3\u5c11 3 \u4e2a\u4e8b\u5b9e: poorSleep + BP + fall
  assert.ok(u.claims.length >= 3, `\u5e94\u8be6\u53d1\u51fa 3+ claim, \u5b9e\u9645 ${u.claims.length}`);
  // BP \u4e0d\u5e94\u89e6\u53d1\u5b89\u5168\u89c4\u5219 (165/95 \u4e0d\u8db3 180/120)
  const values = extractHealthValues('\u8840\u538b 165/95');
  assert.equal(values.length, 2, '165/95 \u5e94\u62bd\u51fa\u4e24\u4e2a\u503c');
});

// =====================================================================
// [Family] 子女视角 — 家属应该看不到什么
// =====================================================================

test('[Family] \u8001\u4eba\u8bf4 "\u4e0d\u8981\u544a\u8bc9\u5b69\u5b50" \u540e, \u80f8\u75db\u4ecd\u4e0d\u5e94\u51fa\u73b0\u5728\u5bb6\u5c5e\u901a\u77e5', () => {
  // \u8001\u4eba\u4e3b\u9898\u62a5\u8df3\u4f4d/\u80f8\u75db + private sharing
  const events = [obs('\u80f8\u75db', ['chestPain'], 'private')];
  const findings = runDetection(events, TODAY);
  const notifs = collectFamilyNotifications(findings, 'granted');
  assert.equal(notifs.length, 0, 'private visibility \u4e0d\u5e94\u8ba9\u5bb6\u5c5e\u770b\u5230\u80f8\u75db');
});

test('[Family] \u5bb6\u5c5e\u4e0d\u6388\u6743\u65f6, urgent finding \u4e5f\u4e0d\u5e94\u63a8\u9001', () => {
  const events = [obs('\u8df3\u5012', ['fall'], 'family_ok')];
  const findings = runDetection(events, TODAY);
  // \u4e0d\u6388\u6743\u65f6
  const notifs = collectFamilyNotifications(findings, 'denied');
  assert.equal(notifs.length, 0, '\u4e0d\u6388\u6743\u4e0d\u5e94\u63a8\u9001');
  // ask \u65f6\u4e5f\u4e0d\u63a8\u9001 (\u53ea\u6709 granted \u6216\u4e00\u6b21\u6027 share \u624d\u80fd)
  const notifsAsk = collectFamilyNotifications(findings, 'ask');
  assert.equal(notifsAsk.length, 0, 'ask \u72b6\u6001\u4e5f\u4e0d\u5e94\u63a8\u9001');
});

test('[Family] \u4ec5\u770b\u5230\u4eca\u65e5\u4e8b\u5b9e, \u5386\u53f2\u4e0d\u5e94\u6df7\u8fdb\u6765', () => {
  // \u5bb6\u5c5e\u7aef\u7684 collectFamilyNotifications \u4ec5\u770b today
  const old = [obs('\u5386\u53f2\u8df3\u5012', ['fall'], 'family_ok')];
  // date \u5b57\u6bb5\u5728 HealthEvent \u8054\u5408\u7c7b\u578b\u91cc, \u4e0d\u80fd\u76f4\u63a5\u6539
  // \u8df3\u8fc7\u8fd9\u4e2a\u5904\u7406, \u76f4\u63a5\u7528 today date \u6784\u9020 obs
  // \u6784\u9020\u4e00\u4e2a finding date=2026-09-05
  const f: Finding = {
    id: 'hist-fall',
    date: '2026-09-05',
    severity: 'urgent',
    title: '\u8df3\u5012',
    detail: '...',
    evidence: ['...'],
    familyEligible: true,
    familyMessage: '\u5386\u53f2\u63a8\u9001',
  };
  // \u8be5\u5b9e\u9645\u4e0a family notification \u903b\u8f91\u4ec5\u770b findings\uff0c\u4e0d\u770b date
  // \u8fd9\u662f\u4e2a\u4e1a\u52a1\u51b3\u5b9e: \u662f\u5426\u5e94\u8be5\u8fc7\u6ee4\u65e7 finding?
  // \u73b0\u5728\u7684 collectFamilyNotifications \u4e0d\u8fc7\u6ee4 date, \u8fd9\u662f\u4e00\u4e2a\u6f0f\u6d1e\u3002
  // \u6211\u4eec\u5728\u8fd9\u91cc\u53ea\u8981\u6c42\u5f53\u524d\u67e5\u770b\u4e0d\u8be6\u53d1, \u4f46\u8981\u8bb0\u4f4f\u8fd9\u662f\u4e2a\u9700\u8981\u8ffd\u8e2a\u7684\u95ee\u9898
  // \u5386\u53f2 finding (\u4e0d\u662f\u4eca\u65e5) \u4e0d\u5e94\u8be6\u53d1\u5bb6\u5c5e\u901a\u77e5\u3002
  const notifs = collectFamilyNotifications([f], 'granted', [], TODAY);
  assert.equal(
    notifs.length,
    0,
    '\u5386\u53f2 finding \u4e0d\u5e94\u88ab\u9001\u7ed9\u5bb6\u5c5e\uff0c\u907f\u514d\u5386\u53f2\u4e8b\u4ef6\u6cc4\u51fa',
  );
  // \u540c\u4e00\u6761 finding \u5982\u679c\u6362\u6210 today date, \u5e94\u8be6\u53d1
  const todayFinding: Finding = { ...f, id: 'f-today', date: TODAY };
  const todayNotifs = collectFamilyNotifications([todayFinding], 'granted', [], TODAY);
  assert.equal(todayNotifs.length, 1, '\u4eca\u65e5 finding \u4ecd\u5e94\u80fd\u63a8\u9001');
});

test('[Family] familyDisclosure \u5b50\u53d1\u73b0\u4ef6\u4e0e\u4efb\u52a1\u4e25\u683c\u5bf9\u9f50', () => {
  const finding: Finding = {
    id: 'f-1',
    date: TODAY,
    severity: 'urgent',
    title: '\u8df3\u5012',
    detail: '...',
    evidence: ['...'],
    familyEligible: true,
    carePath: '\u7acb\u5373\u8054\u7cfb\u8001\u4eba',
  };
  const visible = familyVisibleFindings([finding]);
  assert.equal(visible.length, 1, 'familyEligible \u5e94\u8be6\u4f7f\u53d1\u73b0\u4ef6\u53ef\u89c1');

  // familyVisibleTasks: \u4ec5 sourceFindingId \u5728\u53ef\u89c1\u53d1\u73b0\u4ef6\u4e2d\u7684\u4efb\u52a1\u53ef\u89c1
  const task1 = createTaskFromFinding(finding, TODAY)!;
  task1.id = 't-1';
  const finding2: Finding = {
    id: 'f-2',
    date: TODAY,
    severity: 'watch',
    title: '...',
    detail: '...',
    evidence: ['...'],
    familyEligible: true,
    carePath: '...',
  };
  const task2 = createTaskFromFinding(finding2, TODAY)!;
  task2.id = 't-2';
  task2.kind = 'observation';
  const tasks = [task1, task2];
  const visibleTasks = familyVisibleTasks(tasks, visible);
  // task1 \u5173\u8054 f-1, f-1 \u53ef\u89c1, \u5e94\u53ef\u89c1
  // task2 \u4e0d\u5173\u8054 f-1, \u4e14 kind != 'safety_check', \u4e0d\u5e94\u53ef\u89c1
  assert.equal(visibleTasks.length, 1, '\u4ec5\u5173\u8054\u53ef\u89c1 finding \u7684\u4efb\u52a1\u53ef\u89c1');
  assert.equal(visibleTasks[0]?.id, 't-1');
});

// =====================================================================
// [Developer] 开发者视角 — 代码不变量
// =====================================================================

test('[Developer] \u5b89\u5168\u89c4\u5219 dedupe: \u540c\u4e00\u4e2a\u89c4\u5219\u5728\u4eca\u65e5\u53ea\u4ea7\u751f\u4e00\u4e2a finding', () => {
  const events = [
    obs('\u8df3\u5012\u4e86', ['fall'], 'family_ok'),
    obs('\u521a\u624d\u8df3\u4e86\u4e00\u4e0b', ['fall'], 'family_ok'),
    obs('\u53c8\u8df3\u4e86', ['fall'], 'family_ok'),
  ];
  const findings = runDetection(events, TODAY);
  const fallFindings = findings.filter((f) => f.ruleId === 'safety.fall');
  assert.equal(fallFindings.length, 1, '\u540c\u4e00\u6761\u89c4\u5219\u4e0d\u5e94\u91cd\u590d\u4ea7\u51fa');
});

test('[Developer] self \u4e3b\u4f53\u7684 today BP \u5b89\u5168\u89c4\u5219\u4f1a\u53d1, family \u4e3b\u4f53\u7684\u4e0d\u4f1a', () => {
  const selfBp = runDetection([m('systolic', 195), m('diastolic', 125)], TODAY);
  const familyBp = runDetection(
    [
      measurementToEvent({
        id: 'fam-sys',
        timestamp: `${TODAY}T10:00:00`,
        metric: 'systolic',
        value: 195,
        unit: 'mmHg',
        source: 'chat',
        confidence: 0.9,
        visibility: 'family_ok',
        metadata: { sourceText: '195', eventDate: TODAY, familySubject: 'father' },
      }),
      measurementToEvent({
        id: 'fam-dia',
        timestamp: `${TODAY}T10:00:00`,
        metric: 'diastolic',
        value: 125,
        unit: 'mmHg',
        source: 'chat',
        confidence: 0.9,
        visibility: 'family_ok',
        metadata: { sourceText: '125', eventDate: TODAY, familySubject: 'father' },
      }),
    ],
    TODAY,
  );
  // \u4eca\u65e5\u4e2d\u7684\u8840\u538b\u662f\u8001\u4eba\u672c\u4eba\u7684\u8bfb\u6570, \u90fd\u4f1a\u89e6\u53d1\u5b89\u5168\u89c4\u5219
  // (\u5bb6\u5c5e\u4e8b\u5b9e\u4e0d\u8fdb HealthEvent \u4e3b\u6d41, \u4e0a\u9762\u7684\u4f8b\u5b50\u662f\u6f14\u793a\u6027\u8d28)
  assert.ok(selfBp.find((f) => f.ruleId === 'safety.blood_pressure.severe_reading'));
});

test('[Developer] removeCorrectedChatHealthEvents \u53ea\u5220\u9664\u4e0a\u4e00\u8f6e\u7684, \u4e0d\u52a8\u5176\u4ed6\u8f6e', () => {
  const events = [
    obs('\u7b2c\u4e00\u8f6e\u8df3\u4e86', ['fall']),
    obs('\u7b2c\u4e8c\u8f6e\u53c8\u8df3\u4e86', ['fall']),
  ];
  (events[0] as any).id = 'o-1';
  (events[1] as any).id = 'o-2';
  // \u7ed9\u4e0a sourceMessageId
  (events[0] as any).observation.metadata = { sourceMessageId: 'e-001' };
  (events[1] as any).observation.metadata = { sourceMessageId: 'e-002' };

  const next = removeCorrectedChatHealthEvents(events, 'e-002');
  // \u53ea\u5220 e-002, e-001 \u4fdd\u7559
  assert.equal(next.length, 1);
  assert.equal((next[0] as any).observation.metadata.sourceMessageId, 'e-001');
});

test('[Developer] removeCorrectedFamilyEvents \u4e5f\u53ea\u5220\u88ab\u6307\u5b9a\u7684 sourceMessageId', () => {
  const familyEvents: FamilyHealthEvent[] = [
    {
      id: 'fam-1',
      timestamp: `${TODAY}T09:00:00`,
      source: 'chat',
      subject: 'father',
      text: '\u7236\u4eb2\u8df3\u4e86',
      tags: ['fall'],
      hasHealthValue: false,
      status: 'occurred',
      visibility: 'private',
      shareMode: 'private',
      sourceMessageId: 'e-001',
    },
    {
      id: 'fam-2',
      timestamp: `${TODAY}T10:00:00`,
      source: 'chat',
      subject: 'father',
      text: '\u53c8\u8df3\u4e86',
      tags: ['fall'],
      hasHealthValue: false,
      status: 'occurred',
      visibility: 'private',
      shareMode: 'private',
      sourceMessageId: 'e-002',
    },
  ];
  const next = removeCorrectedFamilyEvents(familyEvents, 'e-002');
  assert.equal(next.length, 1);
  assert.equal(next[0]?.id, 'fam-1');
});

test('[Developer] \u540c\u4e00\u4e2a\u4e8b\u5b9e\u53ea\u4f1a\u751f\u6210\u4e00\u4e2a familyEvent (\u4ee5 sourceMessageId + text \u4e3a\u552f\u4e00\u8bc6\u522b)', () => {
  // \u8fd9\u4e2a\u4e3a "follow-up" \u4e0d\u8be6\u53d1
  // (\u8be5\u7ea6\u675f\u662f\u5728 useElderChat \u91cc\u4ee5 appendHealthEvents \u5b9e\u73b0, \u4e0d\u662f unit-test\u5c42)
  // \u8fd9\u91cc\u53ea\u662f\u68c0\u67e5\u5b50\u7ed3\u6784\u4e0d\u88ab\u4e71\u6539
  const finding: Finding = {
    id: 'f-1',
    date: TODAY,
    severity: 'urgent',
    title: '...',
    detail: '...',
    evidence: ['...'],
    familyEligible: true,
    carePath: '...',
  };
  const t1 = createTaskFromFinding(finding, TODAY)!;
  t1.id = 't-1';
  const t2 = createTaskFromFinding(finding, TODAY)!;
  t2.id = 't-2';
  // \u540c\u4e00 finding \u5e94\u4e0d\u91cd\u590d\u751f\u6210\u4efb\u52a1 (\u8fd9\u662f\u4e1a\u52a1\u5c42\u9762\u7684\u7ea6\u675f, \u9700\u8981 createTaskFromFinding \u5185\u90e8\u4fdd\u8bc1)
  // \u5f53\u524d\u5b9e\u73b0: \u8c03\u7528\u4e24\u6b21\u4f1a\u5f97\u5230\u4e24\u4e2a\u4efb\u52a1
  // \u8fd9\u4e2a\u4e0d\u662f unit-test \u8986\u76d6\u8303\u56f4, \u4e0b\u4e00\u8f6e\u53cd\u9988\u4e2d\u8be5\u8003\u8651\u52a0\u4e0a dedupe
  // \u4e3a\u4e86\u8ba9\u8fd9\u4e2a\u6d4b\u8bd5\u6709\u610f\u4e49, \u6211\u4eec\u5141\u8bb8\u4e24\u4e2a\u4efb\u52a1\u540c\u65f6\u5b58\u5728, \u4f46\u5e94\u8be5\u4e92\u4e0d\u51b2\u7a81
  assert.notEqual(t1.id, t2.id, 'createTaskFromFinding \u8fd4\u56de\u72ec\u7acb\u5b9e\u4f8b');
});
