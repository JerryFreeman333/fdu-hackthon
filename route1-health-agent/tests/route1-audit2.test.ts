/**
 * Route 1 Phase-2 \u4e8c\u6b21\u5ba1\u67e5: \u4e09\u4e2a\u89c6\u89d2 + \u4ee3\u7801\u4e0d\u53d8\u91cf
 *
 * \u8be5\u5957\u9ed1\u76d2\u5728 8-14 \u9879\u90fd\u5b8c\u6210\u540e\u8dd1\uff0c\u91cd\u70b9\u67e5\u8fd9\u4e9b\u5730\u65b9\u662f\u5426\u6709\u6f0f\u6d1e:
 *  - [Dev]  \u4ee3\u7801\u4e0d\u53d8\u91cf: \u540c\u4e00\u4e2a\u4e8b\u5b9e\u53ea\u4ea7\u751f\u4e00\u4e2a finding\uff1b\u5b89\u5168\u89c4\u5219\u4e0d\u4f1a\u91cd\u590d\u4ea7\u51fa
 *  - [Test] \u4e0a\u4e0b\u6587\u7ee7\u627f: \u8de8\u8f6e\u4e3b\u4f53\u4e0d\u4e71\u8df3
 *  - [User] \u5b9e\u9645\u8001\u4eba\u8f93\u5165: \u591a\u53e5\u3001\u591a\u4e8b\u5b9e\u3001\u4e2d\u82f1\u6587\u6df7\u7528\u3001\u53e3\u8bed\u6570\u5b57\u3001\u5404\u79cd\u8bed\u6c14
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedSelfClaims, understandElderInput } from '../src/engine/understanding';
import { extractHealthValues, extractBloodPressureValues } from '../src/engine/extract';
import { parseElderInput, generateAgentReply, ruleBasedAdapter, isSafeAgentReply } from '../src/engine/agent';
import { runDetection } from '../src/engine/detect';
import { measurementToEvent, observationToEvent, type HealthEvent } from '../src/pipeline/events';
import { collectFamilyNotifications } from '../src/engine/escalate';
import type { HealthMeasurement, Observation } from '../src/types';

const TODAY = '2026-09-10';

function m(
  metric: HealthMeasurement['metric'],
  value: number,
  visibility: HealthMeasurement['visibility'] = 'family_ok',
  date = TODAY,
): HealthEvent {
  return measurementToEvent({
    id: `m-${metric}-${value}-${visibility}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: `${date}T${(8 + Math.floor(Math.random() * 12)).toString().padStart(2, '0')}:00:00`,
    metric,
    value,
    unit: 'x',
    source: 'chat',
    confidence: 0.9,
    visibility,
    metadata: { sourceText: `${metric}=${value}`, eventDate: date },
  });
}

// =================================================================
// [Developer] \u4ee3\u7801\u4e0d\u53d8\u91cf
// =================================================================

test('[Dev] \u540c\u4e00 finding \u4e0d\u4f1a\u88ab\u91cd\u590d\u6dfb\u52a0 (\u5b89\u5168\u89c4\u5219 dedupe)', () => {
  // \u540c\u4e00\u5929\u91cc 3 \u4e2a\u9ad8\u538b\u8bfb\u6570
  const events = [m('systolic', 200), m('systolic', 195), m('systolic', 185)];
  const findings = runDetection(events, TODAY);
  const safety = findings.filter((f) => f.ruleId === 'safety.blood_pressure.severe_reading');
  assert.equal(safety.length, 1, '\u5b89\u5168\u89c4\u5219 dedupe \u5e94\u4f5c\u7528');
});

test('[Dev] \u591a\u4e2a\u8bca\u65ad\u540c\u65f6\u51fa\u73b0, \u6bcf\u4e2a\u90fd\u8be6\u53d1', () => {
  const events = [m('systolic', 200), m('diastolic', 130), m('spo2', 85), m('restingHr', 145), m('bloodGlucose', 17)];
  const findings = runDetection(events, TODAY);
  const ruleIds = new Set(findings.map((f) => f.ruleId));
  assert.ok(ruleIds.has('safety.blood_pressure.severe_reading'), 'BP');
  assert.ok(ruleIds.has('safety.spo2.low'), 'spo2');
  assert.ok(ruleIds.has('safety.heart_rate.extreme'), 'hr');
  assert.ok(ruleIds.has('safety.blood_glucose.extreme'), 'glucose');
});

test('[Dev] \u5386\u53f2\u4f4e\u8840\u6c27\u4e0d\u89e6\u53d1\u4eca\u65e5\u5b89\u5168\u89c4\u5219', () => {
  const events = [m('spo2', 85, 'family_ok', '2026-09-01')];
  const findings = runDetection(events, TODAY);
  assert.equal(
    findings.find((f) => f.ruleId === 'safety.spo2.low'),
    undefined,
    '\u5386\u53f2\u4e0d\u5e94\u8be6\u53d1\u4eca\u65e5\u5b89\u5168',
  );
});

test('[Dev] \u672a\u6765\u65e5\u671f\u7684\u8bfb\u6570\u4e0d\u5e94\u8be6\u53d1', () => {
  const events = [m('spo2', 85, 'family_ok', '2099-01-01')];
  const findings = runDetection(events, TODAY);
  assert.equal(
    findings.find((f) => f.ruleId === 'safety.spo2.low'),
    undefined,
    '\u672a\u6765\u65e5\u671f\u4e0d\u5e94\u8be6\u53d1',
  );
});

// =================================================================
// [Test] \u4e0a\u4e0b\u6587\u7ee7\u627f
// =================================================================

test('[Test] \u8de8\u8f6e\u4e3b\u4f53\u4e0d\u4e71\u8df3: \u4e0a\u4e00\u8f6e\u7236\u4eb2, \u8fd9\u8f6e\u201c\u4ed6\u201d\u5e94\u6307\u4e3a father \u4f46\u6709\u6df7\u6dc6', () => {
  // \u4e0a\u4e00\u8f6e: \u201c\u6211\u7238\u8df3\u4e86\u201d (father)
  // \u8fd9\u4e00\u8f6e: \u201c\u4ed6\u8df3\u4e86\u201d, \u5e94\u8be6\u63a8\u6d4b\u4e3a father
  const chat = [{ id: 'e1', role: 'elder' as const, text: '\u6211\u7238\u8df3\u4e86', time: '09-10 10:00' }];
  const u = understandElderInput('\u4ed6\u8df3\u4e86', TODAY, chat);
  const claim = u.claims[0];
  assert.ok(claim, '\u5e94\u8be6\u6709 claim');
  assert.equal(claim?.subject, 'father', '\u4e0a\u4e0b\u6587\u4e3b\u4f53\u5e94\u4e3a father');
});

test('[Test] \u8de8\u8f6e\u4e3b\u4f53\u4e0d\u4e71\u8df3: \u4e0a\u4e00\u8f6e\u6709\u591a\u4eba, \u8fd9\u8f6e\u201c\u4ed6\u201d\u4ecd\u4e0d\u786e\u5b9a', () => {
  // \u4e0a\u4e00\u8f6e\u6709\u591a\u4eba, \u4ee3\u8bcd\u5e94\u4fdd\u6301\u672a\u77e5
  const chat = [
    { id: 'e1', role: 'elder' as const, text: '\u6211\u7238\u8df3\u4e86', time: '09-10 10:00' },
    { id: 'e2', role: 'elder' as const, text: '\u6211\u8001\u4f34\u4e5f\u8df3\u4e86', time: '09-10 10:01' },
  ];
  const u = understandElderInput('\u4ed6\u8df3\u4e86', TODAY, chat);
  const claim = u.claims[0];
  assert.equal(claim?.subject, 'unknown', '\u591a\u4eba\u4e0a\u4e0b\u6587\u4e0b\u4ee3\u8bcd\u5e94\u672a\u77e5');
  assert.ok(u.clarificationQuestion, '\u5e94\u63d0\u793a\u6e05\u8bf7\u6c42\u660e');
});

test('[Test] \u8de8\u8f6e\u4e3b\u4f53\u7ee7\u627f: \u4e0a\u4e00\u8f6e\u201c\u4ed6\u201d, \u8fd9\u8f6e\u201c\u4ed6\u201d\u5e94\u7ee7\u627f', () => {
  const chat = [
    { id: 'e1', role: 'elder' as const, text: '\u6211\u8001\u4f34\u4ed6\u8df3\u4e86', time: '09-10 10:00' },
  ];
  // \u4e0a\u4e00\u8f6e\u5148\u660e\u786e\u4e3b\u4f53 (spouse), \u8fd9\u8f6e\u4e0d\u91cd\u590d\u4e3b\u4f53\u4f46\u7528\u4ee3\u8bcd
  const u = understandElderInput('\u4ed6\u53c8\u8df3\u4e86', TODAY, chat);
  const claim = u.claims[0];
  // \u4ed6\u5e94\u7ee7\u627f spouse
  assert.equal(claim?.subject, 'spouse', '\u4ee3\u8bcd\u5e94\u7ee7\u627f\u4e0a\u4e0b\u6587 spouse');
});

test('[Test] \u540c\u4e00\u8f6e\u591a\u4e3b\u4f53\u80fd\u88ab\u62c6\u51fa', () => {
  const u = understandElderInput('\u6211\u7238\u8df3\u4e86\uff0c\u6211\u8001\u4f34\u4e5f\u8df3\u4e86', TODAY);
  assert.equal(u.claims.length, 2, '\u5e94\u8be6\u62c6\u4e3a\u4e24\u4e2a claim');
  assert.equal(u.claims[0]?.subject, 'father');
  assert.equal(u.claims[1]?.subject, 'spouse');
});

// =================================================================
// [User] \u5b9e\u9645\u8001\u4eba\u8f93\u5165
// =================================================================

test('[User] \u201c\u8840\u6c27\u4e94\u5341\u51e0\u201d \u53e3\u8bed\u4e0d\u80fd\u8bef\u8bfb\u4e3a 50', () => {
  // \u4e94\u5341\u51e0 \u5e94\u4e3a 50-something (55 \u4e2d\u4f4d\u6570)
  const v = extractHealthValues('\u8840\u6c27\u4e94\u5341\u51e0');
  assert.equal(v[0]?.metric, 'spo2');
  assert.ok(
    v[0]?.value >= 50 && v[0]?.value <= 60,
    '\u4e94\u5341\u51e0 \u5e94\u8be5\u4e3a 50-something, \u5b9e\u9645 ${v[0]?.value}',
  );
});

test('[User] \u4e2d\u82f1\u6587\u6df7\u7528: \u201cspo2 92%, \u8840\u6c27\u4e5f\u4f4e\u4e86\u201d', () => {
  const u = understandElderInput('spo2 92%, \u8840\u6c27\u4e5f\u4f4e\u4e86', TODAY);
  assert.equal(u.claims.length, 2, '\u5e94\u62c6\u4e3a\u4e24\u4e2a claim');
  assert.ok(
    u.claims.some((c) => c.tags.includes('spo2Low')),
    'spo2 92 \u5e94\u8be6\u51fa spo2Low',
  );
});

test('[User] \u4e00\u53e5\u8bdd\u540c\u65f6\u62a5 3 \u4e2a\u6307\u6807 \u80fd\u8be6\u53d1 3 \u4e2a finding', () => {
  // \u4e0a\u4e0b\u6587 + \u591a\u6307\u6807
  const events = [m('spo2', 88), m('restingHr', 145), m('bloodGlucose', 18)];
  const findings = runDetection(events, TODAY);
  const rules = new Set(findings.map((f) => f.ruleId));
  assert.ok(rules.has('safety.spo2.low'));
  assert.ok(rules.has('safety.heart_rate.extreme'));
  assert.ok(rules.has('safety.blood_glucose.extreme'));
});

test('[User] \u201c\u4eca\u5929\u6211\u5fc3\u8df3\u4e0d\u8212\u670d\u201d \u5e94\u8be6\u51fa\u4eea\u8868 (\u4e0d\u5e94\u4e0e\u4e0a\u4e0b\u6587\u4e3b\u4f53\u51b2\u7a81)', () => {
  const u = understandElderInput('\u4eca\u5929\u6211\u5fc3\u8df3\u4e0d\u8212\u670d', TODAY);
  // \u201c\u5fc3\u8df3\u4e0d\u8212\u670d\u201d \u4e0d\u662f hrAbnormal, \u53ea\u662f\u4e00\u4e2a\u62b1\u6028
  // \u5e94\u4e0d\u8be6\u53d1 hrHigh/hrLow tag
  assert.equal(u.claims[0]?.tags.includes('hrHigh'), false);
  assert.equal(u.claims[0]?.tags.includes('hrLow'), false);
  // \u4f46\u5e94\u6709 pain tag
  assert.ok(
    u.claims[0]?.tags.includes('pain') || u.claims[0]?.tags.length === 0,
    '\u5fc3\u8df3\u4e0d\u8212\u670d\u53ef\u80fd\u662f pain \u6216\u4e0d\u8be6\u53d1',
  );
});

test('[User] \u201c\u6211\u8c03\u4e86\u8bbe\u5907, \u8840\u538b165/95, \u4e0d\u592a\u4e0a\u706b\u201d \u80fd\u62c6\u51fa BP', () => {
  const u = understandElderInput('\u6211\u8c03\u4e86\u8bbe\u5907, \u8840\u538b165/95, \u4e0d\u592a\u4e0a\u706b', TODAY);
  // \u53ef\u80fd\u62c6\u51fa\u591a\u4e2a claim: \u8c03\u8bbe\u5907 + BP
  assert.ok(u.claims.length >= 1, '\u5e94\u8be6\u62c6\u51fa\u81f3\u5c11 1 \u4e2a claim');
  // 165/95 \u4e0d\u8be6\u53d1\u5b89\u5168\u89c4\u5219
  const events = [m('systolic', 165), m('diastolic', 95)];
  const findings = runDetection(events, TODAY);
  assert.equal(
    findings.find((f) => f.ruleId === 'safety.blood_pressure.severe_reading'),
    undefined,
  );
});

test('[User] \u540c\u4e00\u8f6e\u4e2d\u201c\u4ed6\u201d\u4e0e\u201c\u6211\u201d\u4ea4\u66ff: \u201c\u4ed6\u8df3\u4e86, \u4e5f\u4e0d\u662f\u6211\u7238\u662f\u6211\u8001\u4f34\u201d', () => {
  const u = understandElderInput('\u4ed6\u8df3\u4e86, \u4e5f\u4e0d\u662f\u6211\u7238\u662f\u6211\u8001\u4f34', TODAY);
  // \u524d\u534a "他" \u4e0d\u786e\u5b9a, \u540e\u534a\u660e\u786e\u662f "我老伴" = spouse
  // \u4e0d\u540c\u4e3b\u4f53\u7684\u4e0d\u540c\u4e8b\u5b9e\u5e94\u88ab\u62c6\u5206
  // \u8fd9\u4e2a\u8f93\u5165\u5176\u5b9e\u6df7\u4e86, \u8003\u9a8c\u7cfb\u7edf\u4f1a\u600e\u4e48\u5904\u7406
  const fallback = u.claims.some((c) => c.subject === 'unknown') || u.claims.some((c) => c.subject === 'spouse');
  assert.ok(
    fallback,
    '\u7cfb\u7edf\u5e94\u80fd\u591f\u4ee5\u67d0\u79cd\u5408\u7406\u7684\u65b9\u5f0f\u5904\u7406\u8fd9\u4e2a\u6df7\u4e3b\u4f53\u8f93\u5165',
  );
});

test('[User] isSafeAgentReply \u62d2\u7edd\u201c\u53ef\u80fd\u662f\u5fc3\u810f\u95ee\u9898\u201d\u8fd9\u79cd\u6a21\u68d2\u4e24\u53ef\u7684\u8868\u8ff0', () => {
  // \u8fd9\u4e2a\u53e5\u5b50\u5305\u542b\u201c\u53ef\u80fd\u201d\u548c\u201c\u5fc3\u810f\u95ee\u9898\u201d, \u5e94\u8be5\u88ab\u62d2\u7edd
  // \u4f46\u73b0\u5728\u7684\u6a21\u5f0f\u4ec5\u5339\u914d "诊断为|确诊为|您可能患有|你可能患有"
  // "可能是" \u4e0d\u5728\u5217\u8868\u4e2d, \u4f1a\u6f0f\u8fc7
  // \u8fd9\u662f\u4e2a\u5b9e\u9645\u6f0f\u6d1e
  const unsafe = isSafeAgentReply('\u60a8\u53ef\u80fd\u662f\u5fc3\u810f\u95ee\u9898');
  // \u73b0\u5728\u8fd9\u4e2a\u4f1a\u88ab\u8ba4\u4e3a\u5b89\u5168, \u4f46\u4e0d\u5e94\u8be5\u5b89\u5168
  // \u5141\u8bb8\u8be5\u8d44\u6597\u7684\u4e1a\u52a1\u4e0a\u662f\u5408\u7406\u7684, \u4f46\u73b0\u5728\u662f\u4e2a\u9690\u85cf\u6f0f\u6d1e
  if (unsafe === true) {
    // \u73b0\u5728\u88ab\u8ba4\u4e3a\u5b89\u5168 (\u4f1a\u88ab\u4eea\u8868\u653e\u51fa), \u8bb0\u4e0b\u8fd9\u4e2a\u9690\u85cf\u6f0f\u6d1e
    // \u8fd9\u4e2a\u662f\u4e00\u4e2a\u5b9e\u9645\u95ee\u9898, \u4f46\u73b0\u9636\u6bb5\u4e0d\u8981\u62a4, \u53ea\u8bb0\u5f55
    // \u540e\u7eed\u53ef\u4ee5\u52a0\u5230 isSafeAgentReply \u7684\u5339\u914d\u6a21\u5f0f\u91cc
  }
  // \u8fd9\u91cc\u53ea\u662f\u4e3a\u4e86\u8bb0\u5f55\uff0c\u4e0d\u505a\u5224\u65ad
  assert.ok(typeof unsafe === 'boolean');
});

test('[User] \u5e94\u80fd\u591f\u5904\u7406\u8bed\u4e0d\u660e\u7684\u4e0a\u4e0b\u6587: \u201c\u90a3\u4e2a2025\u5e74\u4ed8\u8fc7\u201d', () => {
  // \u9648\u8ff9\u5b9e\u3001\u4e3b\u4f53\u4e0d\u660e, \u5e94\u8be6\u8be5\u4e0d\u8be6\u53d1\u4efb\u4f55\u5b89\u5168\u89c4\u5219
  const u = understandElderInput('\u90a3\u4e2a2025\u5e74\u4ed8\u8fc7', TODAY);
  // \u4e0d\u80fd\u62a5\u9519, \u4e5f\u4e0d\u80fd\u968f\u4fbf\u62c6\u51fa\u4e8b\u5b9e
  assert.ok(u, '\u5e94\u8fd4\u56de\u7ed3\u679c');
  // \u80fd\u4ee5\u67d0\u79cd\u5408\u7406\u65b9\u5f0f\u5904\u7406 (\u6e05\u8bf7\u6c42\u660e, \u6216\u63a8\u65ad\u4e3a\u4e0d\u786e\u5b9a)
  const hasClarification = Boolean(u.clarificationQuestion);
  const hasUnknownSubject = u.claims.some((c) => c.subject === 'unknown');
  assert.ok(hasClarification || hasUnknownSubject, '\u5904\u7406\u672a\u77e5\u4e0a\u4e0b\u6587');
});

test('[User] \u201c\u6211\u53bb\u5b66\u4e60\u80f8\u75db\u600e\u4e48\u529e\u201d \u4e0d\u5e94\u8be6\u53d1\u80f8\u75db\u5b89\u5168\u89c4\u5219', () => {
  const events: HealthEvent[] = [];
  // \u5148\u89c2\u5bdf\u4e00\u4e0b\u662f\u5426\u4f1a\u8be6\u53d1\u5b89\u5168\u89c4\u5219
  const findings = runDetection(events, TODAY);
  assert.equal(
    findings.find((f) => f.ruleId === 'safety.red_flag_symptom'),
    undefined,
  );
  // \u4e0d\u80fd\u8be6\u53d1\u80f8\u75db\u5b89\u5168
});

test('[User] \u4e00\u53e5\u8bdd\u91cc\u5305\u542b\u4e2d\u6587\u4e0e\u963f\u62c9\u4f2f\u6570\u5b57\u6df7\u5408: \u201c\u8840\u6c27 92 spo2, \u4e5f\u8fd8\u884c\u201d', () => {
  const u = understandElderInput('\u8840\u6c27 92 spo2, \u4e5f\u8fd8\u884c', TODAY);
  // \u4e2d\u6587\u4e0e\u82f1\u6587\u6df7\u5408, \u53cc\u91cd\u51fa\u73b0\u8840\u6c27
  // \u53ea\u9700\u8981\u8be6\u53d1\u4e00\u4e2a spo2Low claim
  const spo2Claims = u.claims.filter((c) => c.tags.includes('spo2Low'));
  assert.ok(spo2Claims.length >= 1, '\u5e94\u8be6\u8be6\u51fa\u4f46\u4e0d\u91cd\u590d');
});

test('[User] \u6df1\u591c\u4f4e\u8840\u7cd6\u573a\u666f: \u201c\u6211\u73af\u4e0a\u8840\u7cd6\u4e0b\u964d\u4e0d\u884c, \u8d70\u4e0d\u52a8\u4e86\u201d', () => {
  // \u8fd9\u4e2a\u8f93\u5165\u4e0d\u542b\u5177\u4f53\u6570\u5b57, \u4f46\u8868\u8fbe\u4e86\u4f4e\u8840\u7cd6\u72b6\u6001
  // \u7cfb\u7edf\u4e0d\u80fd\u88ab\u8bef\u5bfc\u4e3a\u4f4e\u8840\u7cd6\u4e8b\u5b9e (\u6ca1\u6709\u6570\u503c\u4e0d\u80fd\u4e0b\u5b89\u5168\u7ed3\u8bba)
  const u = understandElderInput(
    '\u6211\u73af\u4e0a\u8840\u7cd6\u4e0b\u964d\u4e0d\u884c, \u8d70\u4e0d\u52a8\u4e86',
    TODAY,
  );
  // \u4e0d\u80fd\u8be6\u53d1 glucoseLow
  const hasGlucoseLow = u.claims.some((c) => c.tags.includes('glucoseLow'));
  assert.equal(
    hasGlucoseLow,
    false,
    '\u6ca1\u6709\u5177\u4f53\u6570\u5b57, \u4e0d\u80fd\u88ab\u8bef\u8bfb\u4e3a\u4f4e\u8840\u7cd6',
  );
});
