/** Person Twin：只描述与老人日常生活、行动能力和居家安全有关的状态。 */
import type { ElderProfile, Finding, SymptomTag } from '../types';
import { METRICS } from '../types';
import { diffDays, computeBaseline, recentMean } from './baseline';
import { materializeHealthData, type HealthEvent } from '../pipeline/events';

export type TrendState = 'stable' | 'declining' | 'improving' | 'unknown';

export interface PersonTwin {
  asOf: string;
  activity: TrendState;
  mobility: TrendState;
  sleep: TrendState;
  nightActivity: TrendState;
  recentSymptoms: SymptomTag[];
  activeConcerns: string[];
  safetyRelevantChanges: string[];
  functionalProfile: {
    mobility: ElderProfile['mobility'];
    usesCane: boolean;
    nightVision: ElderProfile['nightVision'];
    cognition: ElderProfile['cognition'];
  };
}

const RELEVANT_METRICS = ['steps', 'walkSpeed', 'sleepHours', 'nightWakes'] as const;
type RelevantMetric = (typeof RELEVANT_METRICS)[number];

function trendFor(
  metric: RelevantMetric,
  records: ReturnType<typeof materializeHealthData>['records'],
  today: string,
): TrendState {
  const baseline = computeBaseline(records, metric, { endDate: today, excludeDays: 3, windowDays: 14, minPoints: 5 });
  const recent = recentMean(records, metric, today, 3);
  if (!baseline || recent === null || Math.abs(baseline.mean) < 1e-9) return 'unknown';
  const badDelta = METRICS[metric].higherIsBad ? recent - baseline.mean : baseline.mean - recent;
  const ratio = badDelta / Math.abs(baseline.mean);
  if (ratio >= 0.15) return 'declining';
  if (ratio <= -0.15) return 'improving';
  return 'stable';
}

function uniqueTags(tags: SymptomTag[]): SymptomTag[] {
  return tags.filter((tag, index) => tags.indexOf(tag) === index);
}

export function buildPersonTwin(
  profile: ElderProfile,
  events: HealthEvent[],
  findings: Finding[],
  today: string,
): PersonTwin {
  const data = materializeHealthData(events);
  const recentSymptoms = uniqueTags(
    data.observations
      .filter((o) => diffDays(o.date, today) >= 0 && diffDays(o.date, today) < 7)
      .flatMap((o) => o.tags),
  );

  const activity = trendFor('steps', data.records, today);
  const mobilityTrend = trendFor('walkSpeed', data.records, today);
  const sleep = trendFor('sleepHours', data.records, today);
  const nightActivity = trendFor('nightWakes', data.records, today);
  const safetyRelevantChanges: string[] = [];

  if (activity === 'declining') safetyRelevantChanges.push('近期活动量下降');
  if (mobilityTrend === 'declining') safetyRelevantChanges.push('近期步行速度下降');
  if (sleep === 'declining') safetyRelevantChanges.push('近期睡眠时长下降');
  if (nightActivity === 'declining') safetyRelevantChanges.push('近期夜间活动增加');
  if (profile.usesCane) safetyRelevantChanges.push('日常使用拐杖');
  if (profile.nightVision === 'reduced') safetyRelevantChanges.push('夜间视力较差');
  if (profile.mobility === 'needs_support') safetyRelevantChanges.push('日常行动需要协助');
  if (profile.cognition === 'mild_change') safetyRelevantChanges.push('近期认知状态有轻度变化');
  if (recentSymptoms.includes('dizziness')) safetyRelevantChanges.push('近期出现头晕主诉');

  const activeConcerns = findings
    .filter((f) => f.severity === 'alert' || f.severity === 'urgent')
    .slice(0, 4)
    .map((f) => f.title);

  return {
    asOf: today,
    activity,
    mobility: mobilityTrend,
    sleep,
    nightActivity,
    recentSymptoms,
    activeConcerns,
    safetyRelevantChanges,
    functionalProfile: {
      mobility: profile.mobility,
      usesCane: profile.usesCane,
      nightVision: profile.nightVision,
      cognition: profile.cognition,
    },
  };
}
