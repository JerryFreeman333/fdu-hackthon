/** Detection Engine 主入口：事件流 → 个人基线 → 变化发现 → 安全分级。 */
import type { Finding, SymptomTag } from '../types';
import { METRICS, type MetricKey } from '../types';
import { diffDays } from './baseline';
import { materializeHealthData, type HealthEvent } from '../pipeline/events';
import { getMetricSignal, hadTag } from './detection/signals';
import { contextualRules } from './detection/rules/contextual';
import { metricBaselineRules } from './detection/rules/metricBaseline';
import { multiSignalRule } from './detection/fusion';
import { bloodPressureSafetyRule, fallSafetyRule, redFlagSymptomRule } from './detection/safety';
import type { DetectionConfig, DetectionContext, DetectionRule } from './detection/types';

export interface DetectionOptions {
  recentDays?: number;
  baselineDays?: number;
  minBaselinePoints?: number;
  minRecentPoints?: number;
}

const DEFAULT_CONFIG: DetectionConfig = { recentDays: 3, baselineDays: 14, minBaselinePoints: 5, minRecentPoints: 2 };
const RULES: DetectionRule[] = [
  ...metricBaselineRules,
  ...contextualRules,
  multiSignalRule,
  bloodPressureSafetyRule,
  redFlagSymptomRule,
  fallSafetyRule,
];

function buildSignals(
  records: DetectionContext['records'],
  today: string,
  config: DetectionConfig,
): DetectionContext['signals'] {
  const metrics: MetricKey[] = [
    'steps',
    'walkSpeed',
    'sleepHours',
    'nightWakes',
    'restingHr',
    'weight',
    'spo2',
    'systolic',
    'diastolic',
    'bloodGlucose',
  ];
  const signals = new Map<MetricKey, NonNullable<ReturnType<typeof getMetricSignal>>>();
  for (const metric of metrics) {
    const signal = getMetricSignal(records, metric, today, config);
    if (signal) signals.set(metric, signal);
  }
  return signals;
}

function dedupeFindings(findings: Finding[]): Finding[] {
  const byId = new Map<string, Finding>();
  for (const finding of findings) {
    const previous = byId.get(finding.id);
    if (!previous || (finding.score ?? 0) > (previous.score ?? 0)) byId.set(finding.id, finding);
  }
  return [...byId.values()];
}

function applyObservationPrivacy(findings: Finding[], observations: DetectionContext['observations']): Finding[] {
  const privateTags = new Set<SymptomTag>();
  for (const observation of observations) {
    if (observation.visibility === 'private') {
      for (const tag of observation.tags) privateTags.add(tag);
    }
  }
  if (privateTags.size === 0) return findings;
  return findings.map((finding) => {
    const protectedSignals = (finding.signalKeys ?? []).some((key) => privateTags.has(key as SymptomTag));
    return protectedSignals ? { ...finding, familyEligible: false } : finding;
  });
}

export function runDetection(events: HealthEvent[], today: string, options: DetectionOptions = {}): Finding[] {
  const config: DetectionConfig = { ...DEFAULT_CONFIG, ...options };
  const materialized = materializeHealthData(events);
  const findings: Finding[] = [];
  const context: DetectionContext = {
    events: materialized.events,
    records: materialized.records,
    observations: materialized.observations,
    labResults: materialized.labResults,
    measurements: materialized.measurements,
    today,
    config,
    signals: buildSignals(materialized.records, today, config),
    findings,
  };

  for (const rule of RULES) {
    const result = rule.evaluate(context);
    if (Array.isArray(result)) findings.push(...result);
    else if (result) findings.push(result);
  }

  const privacyAware = applyObservationPrivacy(dedupeFindings(findings), materialized.observations);
  const order = { urgent: 0, alert: 1, watch: 2, info: 3 } as const;
  return privacyAware.sort((a, b) => {
    const severityDelta = order[a.severity] - order[b.severity];
    if (severityDelta !== 0) return severityDelta;
    return (b.score ?? 0) - (a.score ?? 0);
  });
}

export function todayTags(events: HealthEvent[], today: string): SymptomTag[] {
  return materializeHealthData(events)
    .observations.filter((observation) => observation.date === today)
    .flatMap((observation) => observation.tags)
    .filter((tag, index, array) => array.indexOf(tag) === index);
}

export function recentTag(events: HealthEvent[], tag: SymptomTag, endDate: string, days: number) {
  return hadTag(materializeHealthData(events).observations, tag, endDate, days);
}

export { diffDays, METRICS };
