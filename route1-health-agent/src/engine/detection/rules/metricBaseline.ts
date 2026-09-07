import type { MetricKey } from '../../../types';
import { METRICS } from '../../../types';
import { addFinding } from '../helpers';
import { fmt } from '../signals';
import type { DetectionRule, DetectionContext } from '../types';

const RULES: Array<{ metric: MetricKey; thresholdRatio: number; title: string; detail: string }> = [
  {
    metric: 'steps',
    thresholdRatio: 0.25,
    title: '活动量持续低于个人基线',
    detail: '最近几天走得比平时少了不少，不用勉强运动，先按自己的节奏活动并继续观察。',
  },
  {
    metric: 'walkSpeed',
    thresholdRatio: 0.12,
    title: '步行速度比平时变慢',
    detail: '最近走路速度比平时慢了一些，起身、转身和上下台阶时慢一点，注意脚下。',
  },
  {
    metric: 'sleepHours',
    thresholdRatio: 0.15,
    title: '睡眠时长比平时减少',
    detail: '最近几天睡眠比平时少了，如果持续出现，记得告诉我。',
  },
  {
    metric: 'restingHr',
    thresholdRatio: 0.08,
    title: '静息心率比平时偏高',
    detail: '安静时心跳比平时快了一些，先好好休息，我会继续关注后面的变化。',
  },
  {
    metric: 'spo2',
    thresholdRatio: 0.02,
    title: '血氧比个人平时偏低',
    detail: '这几天血氧比平时低了一些。先坐稳、保持手部温暖，按设备说明复测，并留意有没有呼吸不舒服。',
  },
  {
    metric: 'bloodGlucose',
    thresholdRatio: 0.2,
    title: '血糖相对个人基线发生明显变化',
    detail: '这次记录的血糖和您平时相比有明显变化。先确认测量时间和是否空腹，连续变化再告诉医生。',
  },
];

export const metricBaselineRules: DetectionRule[] = RULES.map((rule) => {
  const ruleId = `metric.${rule.metric}.baseline_shift`;
  return {
    id: ruleId,
    evaluate(context: DetectionContext) {
      const signal = context.signals.get(rule.metric);
      if (!signal || signal.badRatio < rule.thresholdRatio) return null;
      const metric = METRICS[rule.metric];
      return addFinding(context.findings, {
        date: context.today,
        severity: 'watch',
        title: rule.title,
        detail: rule.detail,
        evidence: [
          `最近${context.config.recentDays}天中有 ${signal.recentN} 天数据：${metric.label}平均 ${fmt(rule.metric, signal.recentMean)}，个人基线 ${fmt(rule.metric, signal.baselineMean)}，变差方向约 ${Math.abs(Math.round(signal.badRatio * 100))}%`,
          `基线窗口：${signal.baselineN} 个日数据点${signal.sigma !== null ? `；相对个人波动约 ${signal.sigma.toFixed(1)} SD` : ''}`,
        ],
        ruleId,
        score: Math.max(1, signal.sigma ?? signal.badRatio / rule.thresholdRatio),
        signalKeys: [rule.metric],
      });
    },
  };
});
