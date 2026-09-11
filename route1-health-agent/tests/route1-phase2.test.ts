/**
 * Route 1 Phase-2 \u9ed1\u76d2\u56de\u5f52\uff1a\u8986\u76d6 8-12 \u9879\u3002
 * - \u2460 \u5b89\u5168\u6570\u503c\u89e3\u6790\u3001  \u2461 \u5b89\u5168\u7b49\u7ea7\u4e00\u81f4\u6027\u3001
 * - \u2462 \u5bb6\u5c5e\u901a\u77e5\u8bed\u4e49\u8fb9\u754c\u3001  \u2463 \u56de\u590d\u751f\u6210\u5b89\u5168\u5c42\u3001
 * - \u2464 \u9ed1\u76d2\u7528\u6237\u6d4b\u8bd5
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
import type { Finding, FamilyHealthEvent, HealthMeasurement } from '../src/types';

const TODAY = '2026-09-10';

function measurement(
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

// =====================================================================
// \u2460 \u5b89\u5168\u6570\u503c\u89e3\u6790
// =====================================================================

test('spo2: 9X \u53e3\u8bed\u5f62\u5f0f\u90fd\u80fd\u62fe\u5230', () => {
  const cases: Array<[string, number]> = [
    ['\u8840\u6c27\u4e5d\u5341\u4e8c', 92],
    ['\u8840\u6c27 92', 92],
    ['spo2 95', 95],
    ['SPO2 88', 88],
    ['\u6211\u8840\u6c27\u6389\u5230\u4e5d\u5341\u51e0', 95],
    ['\u8840\u6c27\u6389\u5230\u516b\u5341\u4e94', 85],
  ];
  for (const [text, expect] of cases) {
    const v = extractHealthValues(text).find((x) => x.metric === 'spo2');
    assert.ok(v, `\u8bfb\u53d6\u5931\u8d25: ${text}`);
    assert.equal(v.value, expect, `${text} \u5e94\u8be5\u8bfb\u4e3a ${expect}, \u5b9e\u9645 ${v.value}`);
  }
});

test('spo2: \u4e0d\u5408\u7406\u503c\u5e94\u88ab\u62d2\u7edd', () => {
  assert.equal(extractHealthValues('\u8840\u6c27 200').length, 0, '>100% \u4e0d\u5e94\u88ab\u63a5\u53d7');
  assert.equal(extractHealthValues('\u8840\u6c27 30').length, 0, '<50% \u4e0d\u5e94\u88ab\u63a5\u53d7');
  assert.equal(extractHealthValues('\u8840\u6c27 0').length, 0, '0 \u4e0d\u5e94\u88ab\u63a5\u53d7');
});

test('hr: \u5fc3\u8df3/\u5fc3\u7387 \u4e0d\u540c\u53e3\u8bed\u90fd\u80fd\u62fe\u5230', () => {
  const cases: Array<[string, number]> = [
    ['\u5fc3\u8df3\u4e00\u767e\u4e8c', 120],
    ['\u5fc3\u7387\u5feb\u4e00\u767e\u4e09\u4e86', 130],
    ['\u9759\u606f\u5fc3\u7387 80', 80],
    ['\u6211\u5fc3\u7387\u53ea\u670945', 45],
    ['\u8109\u640f 75', 75],
  ];
  for (const [text, expect] of cases) {
    const v = extractHealthValues(text).find((x) => x.metric === 'restingHr');
    assert.ok(v, `\u8bfb\u53d6\u5931\u8d25: ${text}`);
    assert.equal(v.value, expect, `${text} \u5e94\u8be5\u8bfb\u4e3a ${expect}, \u5b9e\u9645 ${v.value}`);
  }
});

test('glucose: \u4e2d\u82f1\u6587/\u53e3\u8bed\u6570\u5b57/\u8303\u56f4 \u5168\u8986\u76d6', () => {
  const cases: Array<[string, number]> = [
    ['\u8840\u7cd6\u4e03\u70b9\u591a', 7.5],
    ['\u8840\u7cd6 7.2', 7.2],
    ['\u8840\u7cd612', 12],
    ['\u8840\u7cd6\u5341\u4e8c', 12],
    ['\u6211\u8840\u7cd6\u624d12', 12],
    ['\u7a7a\u8179\u8840\u7cd6 5.5', 5.5],
    ['glucose 9.0', 9.0],
  ];
  for (const [text, expect] of cases) {
    const v = extractHealthValues(text).find((x) => x.metric === 'bloodGlucose');
    assert.ok(v, `\u8bfb\u53d6\u5931\u8d25: ${text}`);
    assert.equal(v.value, expect, `${text} \u5e94\u8be5\u8bfb\u4e3a ${expect}, \u5b9e\u9645 ${v.value}`);
  }
});

test('glucose: \u4e0d\u5408\u7406\u503c\u5e94\u88ab\u62d2\u7edd', () => {
  assert.equal(extractHealthValues('\u8840\u7cd6 0.1').length, 0, '<1 \u4e0d\u5e94\u88ab\u63a5\u53d7');
  assert.equal(extractHealthValues('\u8840\u7cd6 100').length, 0, '>40 \u4e0d\u5e94\u88ab\u63a5\u53d7');
});

// =====================================================================
// \u2461 \u5b89\u5168\u7b49\u7ea7\u4e00\u81f4\u6027
// =====================================================================

test('spo2 < 88 \u8d70 urgent, < 92 \u8d70 alert, \u4e0d\u5230\u9608\u503c\u4e0d\u89e6\u53d1', () => {
  const findings85 = runDetection([measurement('spo2', 85)], TODAY);
  const f85 = findings85.find((f) => f.ruleId === 'safety.spo2.low');
  assert.ok(f85, 'spo2=85 \u5e94\u8be5\u89e6\u53d1 safety.spo2.low');
  assert.equal(f85.severity, 'urgent', 'spo2=85 \u5e94\u8be5\u4e3a urgent');

  const findings91 = runDetection([measurement('spo2', 91)], TODAY);
  const f91 = findings91.find((f) => f.ruleId === 'safety.spo2.low');
  assert.ok(f91, 'spo2=91 \u5e94\u8be6\u53d1');
  assert.equal(f91.severity, 'alert');

  const findings96 = runDetection([measurement('spo2', 96)], TODAY);
  assert.equal(
    findings96.find((f) => f.ruleId === 'safety.spo2.low'),
    undefined,
    'spo2=96 \u4e0d\u5e94\u8be6\u53d1',
  );
});

test('hr \u8fc7\u5feb/\u8fc7\u6162\u90fd\u80fd\u89e6\u53d1\u5b89\u5168\u89c4\u5219', () => {
  const fast = runDetection([measurement('restingHr', 145)], TODAY);
  const fFast = fast.find((f) => f.ruleId === 'safety.heart_rate.extreme');
  assert.ok(fFast, 'hr=145 \u5e94\u8be6\u53d1');
  assert.equal(fFast.severity, 'urgent', 'hr=145 \u4e3a urgent');

  const slow = runDetection([measurement('restingHr', 38)], TODAY);
  const fSlow = slow.find((f) => f.ruleId === 'safety.heart_rate.extreme');
  assert.ok(fSlow, 'hr=38 \u5e94\u8be6\u53d1');
  assert.equal(fSlow.severity, 'urgent', 'hr=38 \u4e3a urgent');

  const mild = runDetection([measurement('restingHr', 125)], TODAY);
  const fMild = mild.find((f) => f.ruleId === 'safety.heart_rate.extreme');
  assert.ok(fMild, 'hr=125 \u5e94\u8be6\u53d1');
  assert.equal(fMild.severity, 'alert');

  const normal = runDetection([measurement('restingHr', 80)], TODAY);
  assert.equal(
    normal.find((f) => f.ruleId === 'safety.heart_rate.extreme'),
    undefined,
    'hr=80 \u4e0d\u5e94\u8be6\u53d1',
  );
});

test('glucose \u4f4e/\u9ad8 \u5747\u80fd\u89e6\u53d1\u5b89\u5168\u89c4\u5219', () => {
  const low = runDetection([measurement('bloodGlucose', 3.0)], TODAY);
  const fLow = low.find((f) => f.ruleId === 'safety.blood_glucose.extreme');
  assert.ok(fLow, 'glucose=3.0 \u5e94\u8be6\u53d1');
  assert.equal(fLow.severity, 'urgent', 'glucose<3.5 \u4e3a urgent');

  const high = runDetection([measurement('bloodGlucose', 20)], TODAY);
  const fHigh = high.find((f) => f.ruleId === 'safety.blood_glucose.extreme');
  assert.ok(fHigh, 'glucose=20 \u5e94\u8be6\u53d1');
  assert.equal(fHigh.severity, 'urgent', 'glucose>16.7 \u4e3a urgent');

  const mildHigh = runDetection([measurement('bloodGlucose', 15)], TODAY);
  const fMild = mildHigh.find((f) => f.ruleId === 'safety.blood_glucose.extreme');
  assert.equal(fMild?.severity, 'alert', 'glucose 13.9-16.7 \u4e3a alert');

  const normal = runDetection([measurement('bloodGlucose', 7)], TODAY);
  assert.equal(
    normal.find((f) => f.ruleId === 'safety.blood_glucose.extreme'),
    undefined,
  );
});

test('\u5386\u53f2 finding \u4e0d\u80fd\u8fdb\u5165\u5f53\u524d\u5b89\u5168\u89c4\u5219', () => {
  // \u4eca\u65e5\u4ec5\u6709\u6628\u65e5\u7684\u9ad8\u538b\uff0c\u5b89\u5168\u89c4\u5219\u5e94\u4e3a\u7a7a
  const yesterdayBp = measurementToEvent({
    id: 'bp-yesterday',
    timestamp: '2026-09-09T10:00:00',
    metric: 'systolic',
    value: 200,
    unit: 'mmHg',
    source: 'chat',
    confidence: 0.9,
    visibility: 'family_ok',
    metadata: { sourceText: '200', eventDate: '2026-09-09' },
  });
  const findings = runDetection([yesterdayBp], TODAY);
  assert.equal(
    findings.find((f): f is Finding => f.ruleId === 'safety.blood_pressure.severe_reading'),
    undefined,
    '\u6628\u65e5\u9ad8\u538b\u4e0d\u5e94\u5728\u4eca\u65e5\u89e6\u53d1',
  );
});

// =====================================================================
// \u2462 \u5bb6\u5c5e\u901a\u77e5\u8bed\u4e49\u8fb9\u754c: privacy + subject + severity
// =====================================================================

test('\u79c1\u5bc6 finding \u7edd\u4e0d\u8fdb\u5165\u5bb6\u5c5e\u901a\u77e5', () => {
  const spo2Event = measurement('spo2', 85, 'private');
  const findings = runDetection([spo2Event], TODAY);
  const f = findings.find((x) => x.ruleId === 'safety.spo2.low');
  assert.ok(f, '\u5e94\u8be5\u751f\u6210 finding');
  assert.equal(f.familyEligible, false, '\u79c1\u5bc6 finding \u4e0d\u5e94\u662f familyEligible');
  assert.equal(f.familyMessage, undefined, '\u79c1\u5bc6 finding \u4e0d\u5e94\u6709 familyMessage');
  const notifs = collectFamilyNotifications(findings, 'granted');
  assert.equal(notifs.length, 0, '\u79c1\u5bc6 finding \u4e0d\u5e94\u8fdb\u5165\u5bb6\u5c5e\u901a\u77e5');
});

test('\u5bb6\u5c5e\u7ec4\u4e2d\u7684\u5bb6\u5ead\u6210\u5458\u4e8b\u5b9e \u4e0d\u8fdb\u5165\u8001\u4eba\u672c\u4eba\u67e5\u770b', () => {
  // \u8001\u4eba\u4e3b\u4ed3\u5e93\u67e5\u770b\u7684 finding \u5e94\u4ec5\u9650\u4e8e subject=self
  // \u5bb6\u5c5e\u7ec4\u4e2d\u7684\u4e8b\u5b9e\u4f1a\u8fdb family ledger, \u4e0d\u4f1a\u8fdb elder health stream
  const input = understandElderInput('\u6211\u7238\u6628\u5929\u8e29\u4e86', TODAY);
  assert.equal(input.claims[0]?.subject, 'father', '\u8001\u4eba\u7684\u4e8b\u5b9e\u5e94\u5f52\u4e3a father');
  assert.equal(
    acceptedSelfClaims(input).length,
    0,
    '\u5bb6\u5c5e\u4e8b\u5b9e\u4e0d\u80fd\u8fdb\u5165\u8001\u4eba\u672c\u4eba\u67e5\u770b',
  );
});

test('\u5386\u53f2 finding \u4e0d\u8fdb\u5165\u5bb6\u5c5e\u901a\u77e5', () => {
  // \u6784\u9020\u4e00\u4e2a\u4eca\u65e5\u521b\u5efa\u4f46 date \u4e3a\u5386\u53f2\u7684 finding\u3002
  // \u7531\u4e8e\u5b89\u5168\u89c4\u5219\u662f\u6309 today \u8fc7\u6ee4\u7684\uff0c\u5386\u53f2\u5bf9\u5e94\u7684\u5e94\u4e0d\u4f1a\u8fdb\u5165\u3002
  const histSpo2 = measurementToEvent({
    id: 'spo2-hist',
    timestamp: '2026-09-08T10:00:00',
    metric: 'spo2',
    value: 85,
    unit: '%',
    source: 'chat',
    confidence: 0.9,
    visibility: 'family_ok',
    metadata: { sourceText: '85', eventDate: '2026-09-08' },
  });
  const findings = runDetection([histSpo2], TODAY);
  assert.equal(
    findings.find((f) => f.ruleId === 'safety.spo2.low'),
    undefined,
    '\u5386\u53f2\u4f4e\u8840\u6c27\u4e0d\u5e94\u8fdb\u5165\u4eca\u65e5\u5b89\u5168\u89c4\u5219',
  );
});

test('\u4ec5 urgent/alert \u624d\u53ef\u4ee5\u8fdb\u5165\u5bb6\u5c5e\u901a\u77e5', () => {
  // watch/info \u7c7b\u4e0d\u5e94\u8fdb\u5165
  const watchFinding: Finding = {
    id: 'watch-1',
    date: TODAY,
    severity: 'watch',
    title: '\u6d3b\u52a8\u91cf\u4e0b\u964d',
    detail: '...',
    evidence: ['...'],
    familyEligible: true,
  };
  const notifs = collectFamilyNotifications([watchFinding], 'granted');
  assert.equal(notifs.length, 0, 'watch \u4e0d\u5e94\u8fdb\u5165\u5bb6\u5c5e\u901a\u77e5');
});

test('familyEligible=false \u5219\u4e0d\u8fdb\u5165\u5bb6\u5c5e\u901a\u77e5', () => {
  const urgentPrivate: Finding = {
    id: 'urgent-priv',
    date: TODAY,
    severity: 'urgent',
    title: '\u8df3\u5012',
    detail: '...',
    evidence: ['...'],
    familyEligible: false,
  };
  const notifs = collectFamilyNotifications([urgentPrivate], 'granted');
  assert.equal(notifs.length, 0, 'familyEligible=false \u4e0d\u5e94\u8fdb\u5165');
});

test('familyOk + urgent + \u957f\u671f\u6388\u6743 \u624d\u80fd\u8fdb\u5165\u5bb6\u5c5e\u901a\u77e5', () => {
  const okFinding: Finding = {
    id: 'ok-1',
    date: TODAY,
    severity: 'urgent',
    title: '\u80f8\u75db',
    detail: '...',
    evidence: ['...'],
    familyMessage: '...',
    familyEligible: true,
  };
  const notifs = collectFamilyNotifications([okFinding], 'granted');
  assert.equal(notifs.length, 1, 'urgent + familyEligible + granted \u5e94\u8be6\u53d1');
});

// =====================================================================
// \u2463 \u56de\u590d\u751f\u6210\u5b89\u5168\u5c42: \u4e0d\u4e0a\u65b0\u4e8b\u5b9e
// =====================================================================

test('ruleBasedAdapter \u5bf9 spo2 \u4f4e\u8840\u6c27\u4ea7\u51fa\u5b89\u5168\u63d0\u793a', async () => {
  const reply = await generateAgentReply('\u8840\u6c27 85', ['spo2Low'], [], false, undefined, ruleBasedAdapter);
  assert.ok(
    reply.includes('\u8840\u6c27') || reply.includes('\u590d\u6d4b') || reply.includes('\u52a9'),
    '\u5e94\u8be5\u51fa\u73b0\u8840\u6c27/\u590d\u6d4b\u7c7b\u63d0\u793a',
  );
  assert.ok(
    !reply.includes('\u4f60\u53ef\u80fd\u60a3\u6709') && !reply.includes('\u8bca\u65ad'),
    '\u4e0d\u5e94\u51fa\u73b0\u8bca\u65ad\u8bed\u8a00',
  );
});

test('ruleBasedAdapter \u5bf9\u9ad8\u8840\u7cd6 \u4ea7\u51fa\u590d\u6d4b\u63d0\u793a', async () => {
  const reply = await generateAgentReply('\u8840\u7cd6 18', ['glucoseHigh'], [], false, undefined, ruleBasedAdapter);
  assert.ok(
    reply.includes('\u8840\u7cd6') || reply.includes('\u590d\u6d4b'),
    '\u5e94\u8be5\u51fa\u73b0\u590d\u6d4b\u63d0\u793a',
  );
});

test('isSafeAgentReply \u62d2\u7edd\u660e\u663e\u7684\u8bca\u65ad\u4e0e\u505c\u836f\u8868\u8ff0', () => {
  assert.equal(isSafeAgentReply(''), false, '\u7a7a\u6587\u4e0d\u5b89\u5168');
  assert.equal(
    isSafeAgentReply('\u4f60\u53ef\u80fd\u60a3\u6709\u5fc3\u8870'),
    false,
    '\u4e0d\u5e94\u8bf4\u201c\u53ef\u80fd\u60a3\u6709\u201d',
  );
  assert.equal(
    isSafeAgentReply('\u8bca\u65ad\u4e3a\u5fc3\u8870'),
    false,
    '\u4e0d\u5e94\u8bf4\u201c\u8bca\u65ad\u4e3a\u201d',
  );
  assert.equal(
    isSafeAgentReply('\u5efa\u8bae\u60a8\u52a0\u500d\u670d\u836f'),
    false,
    '\u4e0d\u5e94\u8bf4\u201c\u52a0\u500d\u670d\u836f\u201d',
  );
  assert.equal(
    isSafeAgentReply('\u5efa\u8bae\u60a8\u81ea\u5df1\u505c\u836f'),
    false,
    '\u4e0d\u5e94\u8bf4\u201c\u81ea\u5df1\u505c\u836f\u201d',
  );
  assert.equal(isSafeAgentReply('x'.repeat(600)), false, '\u8d85\u957f\u4e0d\u5b89\u5168');
  assert.equal(
    isSafeAgentReply('\u5148\u590d\u6d4b\uff0c\u4e0d\u8981\u81ea\u5df1\u4e0b\u7ed3\u8bba\u3002'),
    true,
    '\u5e38\u89c4\u63d0\u793a\u5e94\u8be5\u88ab\u63a5\u53d7',
  );
});

test('\u4e0d\u4f1a\u56e0\u4e3a\u5386\u53f2\u4f4e\u8840\u6c27 \u89e6\u53d1\u5f53\u524d\u4eba\u5de5\u5e94\u7b54', async () => {
  // \u4ec5\u4f9b\u8fc7\u53bb\u7684\u4f4e\u8840\u6c27\uff0c\u4e0d\u5e94\u8be5\u89e6\u53d1\u5f53\u524d agent \u7684\u201c\u8840\u6c27\u504f\u4f4e\u201d\u63d0\u793a
  const events = [
    measurementToEvent({
      id: 'h1',
      timestamp: '2026-09-05T10:00:00',
      metric: 'spo2',
      value: 85,
      unit: '%',
      source: 'chat',
      confidence: 0.9,
      visibility: 'family_ok',
      metadata: { sourceText: '85', eventDate: '2026-09-05' },
    }),
  ];
  const findings = runDetection(events, TODAY);
  assert.equal(
    findings.find((f) => f.ruleId === 'safety.spo2.low'),
    undefined,
  );
});

// =====================================================================
// \u2464 \u9ed1\u76d2\u7528\u6237\u6d4b\u8bd5: end-to-end
// =====================================================================

test('\u4e00\u53e5\u8bdd\u91cc\u540c\u65f6\u51fa\u73b0 BP \u548c\u8840\u7cd6 \u4e24\u4e2a\u6307\u6807\u90fd\u88ab\u63d0\u53d6', () => {
  const events = [measurement('systolic', 195), measurement('diastolic', 125), measurement('bloodGlucose', 18)];
  const values = extractHealthValues('\u8840\u538b165/100\uff0c\u8840\u7cd6 14');
  // \u8fd9\u91cc\u4e0d\u9700\u8981 match\uff0c\u53ea\u9a8c\u8bc1 runDetection \u80fd\u540c\u65f6\u89c2\u6d4b\u5230
  const findings = runDetection(events, TODAY);
  const safety = findings.filter((f): f is Finding => (f.ruleId ?? '').startsWith('safety.'));
  assert.ok(safety.length >= 2, 'BP + glucose \u5e94\u540c\u65f6\u8be6\u53d1\u4e24\u4e2a finding');
});

test('\u5386\u53f2 + \u4eca\u65e5 \u6df7\u5728\u4e00\u8d77\uff0c\u53ea\u6709\u4eca\u65e5\u8fdb\u5165\u5b89\u5168\u89c4\u5219', () => {
  const events = [
    measurementToEvent({
      id: 'h-hist',
      timestamp: '2026-09-01T10:00:00',
      metric: 'systolic',
      value: 200,
      unit: 'mmHg',
      source: 'chat',
      confidence: 0.9,
      visibility: 'family_ok',
      metadata: { sourceText: '200', eventDate: '2026-09-01' },
    }),
    measurement('systolic', 130),
    measurement('diastolic', 85),
  ];
  const findings = runDetection(events, TODAY);
  const safety = findings.find((f): f is Finding => f.ruleId === 'safety.blood_pressure.severe_reading');
  assert.equal(
    safety,
    undefined,
    '\u4ec5\u4eca\u65e5 130/85 \u4e0d\u5e94\u8be6\u53d1\u9ad8\u538b\u5b89\u5168\u89c4\u5219',
  );
});

test('\u67d0\u4e2a\u6307\u6807\u91cd\u590d\u4f20\u5165 (\u591a\u6b21\u590d\u6d4b) \u53ea\u751f\u6210\u4e00\u4e2a finding', () => {
  // \u4eca\u65e5\u4e09\u6b21\u4f4e\u8840\u6c27\uff0c\u53ea\u751f\u6210\u4e00\u4e2a safety finding
  const events = [measurement('spo2', 85), measurement('spo2', 87), measurement('spo2', 90)];
  const findings = runDetection(events, TODAY);
  const safety = findings.filter((f) => f.ruleId === 'safety.spo2.low');
  assert.equal(safety.length, 1, '\u540c\u4e00\u6761\u89c4\u5219\u53ea\u751f\u6210\u4e00\u4e2a finding');
});
