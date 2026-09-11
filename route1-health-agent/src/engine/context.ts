/** Agent Context：把近期事件与 Person Twin 压缩成 Agent 可消费、可解释的上下文。 */
import type { ElderProfile, Finding, MetricKey, SymptomTag, PrivacyScope } from '../types';
import { METRICS } from '../types';
import { diffDays, computeBaseline, recentMean } from './baseline';
import { isPublicHealthEvent, materializeHealthData, type HealthEvent } from '../pipeline/events';
import { buildPersonTwin, type PersonTwin } from './personTwin';

export interface AgentMetricContext {
  metric: MetricKey;
  label: string;
  unit: string;
  latestValue: number;
  latestTimestamp: string;
  recentMean: number | null;
  baselineMean: number | null;
  changeRatio: number | null;
  direction: 'higher' | 'lower' | 'stable' | 'unknown';
  visibility?: PrivacyScope;
}
export interface AgentObservationContext {
  date: string;
  text: string;
  tags: SymptomTag[];
  visibility?: 'private' | 'family_ok';
}
export interface AgentLabContext {
  name: string;
  value: number;
  unit: string;
  timestamp: string;
  visibility?: PrivacyScope;
}
export interface AgentFindingContext {
  severity: Finding['severity'];
  title: string;
  detail: string;
  evidence: string[];
  ruleId?: string;
  familyEligible?: boolean;
}

export interface AgentContext {
  today: string;
  windowDays: number;
  safetyLevel: Finding['severity'];
  personTwin: PersonTwin;
  /** 仅用公开数据（非 private、familyEligible）重算的 Person Twin：供外部 LLM 上下文使用。 */
  personTwinPublic: PersonTwin;
  metrics: AgentMetricContext[];
  observations: AgentObservationContext[];
  labs: AgentLabContext[];
  priorityFindings: AgentFindingContext[];
  suggestedAction?: string;
}

const METRIC_KEYS: MetricKey[] = [
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
const SEVERITY_ORDER: Record<Finding['severity'], number> = { urgent: 0, alert: 1, watch: 2, info: 3 };

function directionFor(changeRatio: number | null): AgentMetricContext['direction'] {
  if (changeRatio === null) return 'unknown';
  if (Math.abs(changeRatio) < 0.05) return 'stable';
  return changeRatio > 0 ? 'higher' : 'lower';
}

function buildMetricContexts(
  records: ReturnType<typeof materializeHealthData>['records'],
  measurements: ReturnType<typeof materializeHealthData>['measurements'],
  today: string,
  windowDays: number,
): AgentMetricContext[] {
  const output: AgentMetricContext[] = [];
  for (const metric of METRIC_KEYS) {
    const recentMeasurements = measurements
      .filter(
        (m) =>
          m.metric === metric &&
          diffDays(m.timestamp.slice(0, 10), today) >= 0 &&
          diffDays(m.timestamp.slice(0, 10), today) < windowDays,
      )
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
    const latest = recentMeasurements[recentMeasurements.length - 1];
    if (!latest) continue;
    const recent = recentMean(records, metric, today, windowDays);
    const baseline = computeBaseline(records, metric, {
      endDate: today,
      excludeDays: windowDays,
      windowDays: 14,
      minPoints: 5,
    });
    const changeRatio =
      baseline && Math.abs(baseline.mean) > 1e-9 && recent !== null
        ? (recent - baseline.mean) / Math.abs(baseline.mean)
        : null;
    output.push({
      metric,
      label: METRICS[metric].label,
      unit: METRICS[metric].unit,
      latestValue: latest.value,
      latestTimestamp: latest.timestamp,
      recentMean: recent,
      baselineMean: baseline?.mean ?? null,
      changeRatio,
      direction: directionFor(changeRatio),
      visibility: latest.visibility,
    });
  }
  return output;
}

export function buildAgentContext(
  profile: ElderProfile,
  events: HealthEvent[],
  today: string,
  findings: Finding[],
  windowDays = 7,
): AgentContext {
  const materialized = materializeHealthData(events);
  const observations = materialized.observations
    .filter((o) => diffDays(o.date, today) >= 0 && diffDays(o.date, today) < windowDays)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8)
    .map((o) => ({ date: o.date, text: o.text, tags: o.tags, visibility: o.visibility }));
  const labs = materialized.labResults
    .filter(
      (lab) => diffDays(lab.timestamp.slice(0, 10), today) >= 0 && diffDays(lab.timestamp.slice(0, 10), today) < 30,
    )
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 8)
    .map((lab) => ({
      name: lab.name,
      value: lab.value,
      unit: lab.unit,
      timestamp: lab.timestamp,
      visibility: lab.visibility,
    }));
  const priorityFindings = [...findings]
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 6)
    .map((finding) => ({
      severity: finding.severity,
      title: finding.title,
      detail: finding.detail,
      evidence: finding.evidence.slice(0, 3),
      ruleId: finding.ruleId,
      familyEligible: finding.familyEligible,
    }));
  const safetyLevel = findings.reduce<Finding['severity']>(
    (highest, finding) => (SEVERITY_ORDER[finding.severity] < SEVERITY_ORDER[highest] ? finding.severity : highest),
    'info',
  );
  return {
    today,
    windowDays,
    safetyLevel,
    personTwin: buildPersonTwin(profile, events, findings, today),
    personTwinPublic: buildPersonTwin(
      profile,
      events.filter(isPublicHealthEvent),
      findings.filter((finding) => finding.familyEligible !== false),
      today,
    ),
    metrics: buildMetricContexts(materialized.records, materialized.measurements, today, windowDays),
    observations,
    labs,
    priorityFindings,
    suggestedAction: findings.find((f) => f.carePath)?.carePath,
  };
}
