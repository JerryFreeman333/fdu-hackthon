/**
 * Route 1 \u4eea\u8868/\u68c0\u6d4b/\u5b89\u5168\u89c4\u5219/\u5bb6\u5c5e\u901a\u77e5 end-to-end \u96c6\u6210\u9a8c\u8bc1\u3002
 *
 * \u9a8c\u8bc1\u4e00\u53e5\u8bdd\u4ece \u89e3\u6790 \u2192 \u63a5\u53d7 \u2192 \u63d0\u53d6\u503c \u2192 \u8be6\u53d1 finding \u2192 \u5bb6\u5c5e\u901a\u77e5 \u2192 \u4eea\u8868 \u8d70\u5b8c\u6574\u4e2a\u94fe\u8def
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedSelfClaims, understandElderInput } from '../src/engine/understanding';
import { extractHealthValues } from '../src/engine/extract';
import { parseElderInput, generateAgentReply, ruleBasedAdapter } from '../src/engine/agent';
import { runDetection } from '../src/engine/detect';
import { measurementToEvent, observationToEvent, type HealthEvent } from '../src/pipeline/events';
import { collectFamilyNotifications } from '../src/engine/escalate';
import type { HealthMeasurement, Observation } from '../src/types';

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

test('e2e: \u201c\u8840\u6c27 85\u201d \u5168\u94fe\u8def\u4e00\u81f4\uff1a\u89e3\u6790\u51fa spo2Low\u3001\u63a5\u53d7\u3001\u8be6\u53d1 finding\u3001\u63d0\u793a\u542b\u771f\u5b9e\u8bfb\u6570', async () => {
  const u = understandElderInput('\u8840\u6c27 85', TODAY);
  const accepted = acceptedSelfClaims(u);
  assert.equal(accepted.length, 1, '\u672c\u4eba\u5e94\u63a5\u53d7');
  assert.equal(accepted[0]?.hasHealthValue, true, '\u5e94\u62bd\u51fa\u8840\u6c27\u503c');
  // extractHealthValues \u5e94\u8be6\u51fa 85
  const values = extractHealthValues('\u8840\u6c27 85');
  assert.equal(values.length, 1);
  assert.equal(values[0]?.value, 85);
  // \u6784\u9020\u4e8b\u4ef6\u540e runDetection \u5e94\u8be6\u53d1 spo2 \u5b89\u5168\u89c4\u5219
  const events = [m('spo2', 85)];
  const findings = runDetection(events, TODAY);
  const safety = findings.find((f) => f.ruleId === 'safety.spo2.low');
  assert.ok(safety, '\u5e94\u8be6\u53d1 spo2 \u5b89\u5168\u89c4\u5219');
  assert.equal(safety?.severity, 'urgent', '85% \u5e94\u4e3a urgent');
  // \u4eea\u8868\u5e94\u542b\u771f\u5b9e\u8bfb\u6570
  const reply = await generateAgentReply('\u8840\u6c27 85', ['spo2Low'], [], false, undefined, ruleBasedAdapter);
  assert.ok(reply.includes('85'), `\u4eea\u8868\u5e94\u542b\u771f\u5b9e\u8bfb\u6570 85: ${reply}`);
});

test('e2e: \u201c\u5fc3\u7387\u5feb\u4e00\u767e\u4e09\u4e86\u201d \u5168\u94fe\u8def\u4e00\u81f4\uff1a\u89e3\u6790\u51fa hrHigh\u3001\u63a5\u53d7\u3001\u8be6\u53d1 finding\u3001\u4eea\u8868\u542b\u771f\u5b9e\u8bfb\u6570', async () => {
  const u = understandElderInput('\u5fc3\u7387\u5feb\u4e00\u767e\u4e09\u4e86', TODAY);
  const accepted = acceptedSelfClaims(u);
  assert.equal(accepted.length, 1);
  assert.ok(accepted[0]?.tags.includes('hrHigh'));
  const values = extractHealthValues('\u5fc3\u7387\u5feb\u4e00\u767e\u4e09\u4e86');
  assert.ok(values.some((v) => v.metric === 'restingHr' && v.value === 130));
  const events = [m('restingHr', 140)];
  const findings = runDetection(events, TODAY);
  const safety = findings.find((f) => f.ruleId === 'safety.heart_rate.extreme');
  assert.ok(safety, '\u5e94\u8be6\u53d1\u5fc3\u7387\u5b89\u5168\u89c4\u5219');
  assert.equal(safety?.severity, 'urgent', '130 \u5e94\u4e3a urgent');
  const reply = await generateAgentReply(
    '\u5fc3\u7387\u5feb\u4e00\u767e\u4e09\u4e86',
    ['hrHigh'],
    [],
    false,
    undefined,
    ruleBasedAdapter,
  );
  assert.ok(reply.includes('130'), `\u4eea\u8868\u5e94\u542b\u771f\u5b9e\u8bfb\u6570 130: ${reply}`);
});

test('e2e: \u201c\u8840\u7cd6 3.0\u201d \u5168\u94fe\u8def\u4e00\u81f4\uff1a\u89e3\u6790\u51fa glucoseLow\u3001\u8be6\u53d1 urgent finding', async () => {
  const u = understandElderInput('\u8840\u7cd6 3.0', TODAY);
  const accepted = acceptedSelfClaims(u);
  assert.equal(accepted.length, 1);
  assert.ok(accepted[0]?.tags.includes('glucoseLow'));
  const events = [m('bloodGlucose', 3.0)];
  const findings = runDetection(events, TODAY);
  const safety = findings.find((f) => f.ruleId === 'safety.blood_glucose.extreme');
  assert.ok(safety);
  assert.equal(safety?.severity, 'urgent', '3.0 \u5e94\u4e3a urgent');
  const reply = await generateAgentReply('\u8840\u7cd6 3.0', ['glucoseLow'], [], false, undefined, ruleBasedAdapter);
  assert.ok(reply.includes('3'), `\u4eea\u8868\u5e94\u542b\u771f\u5b9e\u8bfb\u6570 3.0: ${reply}`);
});

test('e2e: \u4e09\u4e2a\u6307\u6807\u540c\u65f6\u51fa\u73b0\u65f6\uff0c\u8be6\u53d1\u4e09\u4e2a\u72ec\u7acb finding', async () => {
  const events = [m('systolic', 195), m('diastolic', 125), m('spo2', 88), m('bloodGlucose', 16.5)];
  const findings = runDetection(events, TODAY);
  const rules = new Set(findings.map((f) => f.ruleId));
  assert.ok(rules.has('safety.blood_pressure.severe_reading'));
  assert.ok(rules.has('safety.spo2.low'));
  assert.ok(rules.has('safety.blood_glucose.extreme'));
  // \u5bb6\u5c5e\u53ef\u770b\u5230\u4e09\u6761\u901a\u77e5
  const notifs = collectFamilyNotifications(findings, 'granted');
  assert.equal(notifs.length, 3);
});

test('e2e: \u79c1\u5bc6 \u8840\u6c27 \u4e0d\u8d70\u5bb6\u5c5e\u901a\u77e5\uff0c\u672c\u5730\u4ecd\u544a\u77e5', async () => {
  const events = [m('spo2', 85, 'private')];
  const findings = runDetection(events, TODAY);
  const safety = findings.find((f) => f.ruleId === 'safety.spo2.low');
  assert.ok(safety);
  assert.equal(safety?.familyEligible, false, 'private \u4e0d\u80fd\u662f familyEligible');
  const notifs = collectFamilyNotifications(findings, 'granted');
  assert.equal(notifs.length, 0, 'private \u4e0d\u5e94\u8fdb\u5165\u5bb6\u5c5e\u901a\u77e5');
  // \u4f46\u4eea\u8868\u4ecd\u7136\u4f1a\u8be6\u51d1\u91cf
  const reply = await generateAgentReply('\u6211\u8840\u6c27 85', ['spo2Low'], [], false, undefined, ruleBasedAdapter);
  assert.ok(reply.includes('85'));
});

test('e2e: parseElderInput \u80fd\u4ece\u201c\u8840\u6c27\u4e5d\u5341\u4e8c\u201d\u4e2d\u8bc6\u522b spo2Low', () => {
  const parsed = parseElderInput('\u8840\u6c27\u4e5d\u5341\u4e8c');
  assert.ok(parsed.tags.includes('spo2Low'), `\u5e94\u8be6\u51fa spo2Low: ${JSON.stringify(parsed.tags)}`);
});

test('e2e: parseElderInput \u80fd\u4ece\u201c\u5fc3\u8df3\u4e00\u767e\u4e8c\u201d\u4e2d\u8bc6\u522b hrHigh', () => {
  const parsed = parseElderInput('\u5fc3\u8df3\u4e00\u767e\u4e8c');
  assert.ok(parsed.tags.includes('hrHigh'), `\u5e94\u8be6\u51fa hrHigh: ${JSON.stringify(parsed.tags)}`);
});

test('e2e: parseElderInput \u80fd\u4ece\u201c\u8840\u7cd6\u4e03\u70b9\u591a\u201d\u4e2d\u8bc6\u522b glucoseHigh', () => {
  const parsed = parseElderInput('\u8840\u7cd6 16');
  assert.ok(
    parsed.tags.includes('glucoseHigh') || parsed.tags.includes('glucoseLow'),
    `\u5e94\u8be6\u51fa glucoseHigh/Low: ${JSON.stringify(parsed.tags)}`,
  );
});
