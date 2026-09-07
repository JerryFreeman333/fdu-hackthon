import type { MetricKey } from '../../types';
import { diffDays } from '../baseline';
import { addFinding } from './helpers';
import { hadTag, fmt } from './signals';
import type { DetectionRule } from './types';

/** Fusion taxonomy: each signal family contributes at most one category. */
export const multiSignalRule: DetectionRule = {
  id: 'fusion.multisignal_deterioration',
  evaluate(context) {
    const fatigue = hadTag(context.observations, 'fatigue', context.today, context.config.recentDays);
    const poorSleep = hadTag(context.observations, 'poorSleep', context.today, context.config.recentDays);
    const dyspnea = hadTag(context.observations, 'dyspnea', context.today, context.config.recentDays);
    const dizziness = hadTag(context.observations, 'dizziness', context.today, context.config.recentDays);
    const edema = hadTag(context.observations, 'edema', context.today, context.config.recentDays);

    const steps = context.signals.get('steps');
    const speed = context.signals.get('walkSpeed');
    const weight = context.signals.get('weight');
    const wakes = context.signals.get('nightWakes');
    const sleepHours = context.signals.get('sleepHours');
    const hr = context.signals.get('restingHr');
    const spo2 = context.signals.get('spo2');

    // Activity: objective mobility/volume change.
    const activity = (steps !== undefined && steps.badRatio >= 0.2) || (speed !== undefined && speed.badRatio >= 0.1);
    // Subjective symptoms: all recent symptom observations share one category.
    const symptom = fatigue !== null || dyspnea !== null || dizziness !== null || poorSleep !== null;
    // Volume/sleep: weight, edema, night waking and objectively shorter sleep share one category.
    const volumeSleep =
      (weight !== undefined && weight.badRatio >= 0.015) ||
      edema !== null ||
      (wakes !== undefined && wakes.badRatio >= 0.5) ||
      (sleepHours !== undefined && sleepHours.badRatio >= 0.15);
    // Physiologic: vital-sign changes form their own category.
    const physiologic = (hr !== undefined && hr.badRatio >= 0.05) || (spo2 !== undefined && spo2.badRatio >= 0.02);
    const categories = [activity, symptom, volumeSleep, physiologic].filter(Boolean).length;
    if (categories < 3) return null;

    const objectiveSignalKeys: MetricKey[] = [];
    if (steps && steps.badRatio >= 0.2) objectiveSignalKeys.push('steps');
    if (speed && speed.badRatio >= 0.1) objectiveSignalKeys.push('walkSpeed');
    if (weight && weight.badRatio >= 0.015) objectiveSignalKeys.push('weight');
    if (wakes && wakes.badRatio >= 0.5) objectiveSignalKeys.push('nightWakes');
    if (sleepHours && sleepHours.badRatio >= 0.15) objectiveSignalKeys.push('sleepHours');
    if (hr && hr.badRatio >= 0.05) objectiveSignalKeys.push('restingHr');
    if (spo2 && spo2.badRatio >= 0.02) objectiveSignalKeys.push('spo2');

    const hasPrivateObjectiveEvidence = context.measurements.some(
      (measurement) =>
        objectiveSignalKeys.includes(measurement.metric) &&
        measurement.visibility === 'private' &&
        diffDays(measurement.timestamp.slice(0, 10), context.today) >= 0 &&
        diffDays(measurement.timestamp.slice(0, 10), context.today) < context.config.recentDays,
    );
    const symptomObservations = [fatigue, poorSleep, dyspnea, dizziness, edema].filter(
      (item): item is NonNullable<typeof item> => item !== null,
    );
    const familyEligible =
      !hasPrivateObjectiveEvidence && symptomObservations.every((observation) => observation.visibility !== 'private');
    const evidence: string[] = [`共 ${categories} 个维度出现变化（活动、主诉、容量/睡眠、生理指标）`];
    const signalKeys: string[] = [];

    if (steps && steps.badRatio >= 0.2) {
      evidence.push(
        `活动量：最近平均 ${Math.round(steps.recentMean)} 步/天，比基线低约 ${Math.round(steps.badRatio * 100)}%`,
      );
      signalKeys.push('steps');
    }
    if (speed && speed.badRatio >= 0.1) {
      evidence.push(
        `步速：平均 ${fmt('walkSpeed', speed.recentMean)}，比基线慢约 ${Math.round(speed.badRatio * 100)}%`,
      );
      signalKeys.push('walkSpeed');
    }
    if (fatigue) {
      evidence.push(`主诉：${fatigue.date} 说“${fatigue.text}”`);
      signalKeys.push('fatigue');
    }
    if (dyspnea) {
      evidence.push(`主诉：${dyspnea.date} 说“${dyspnea.text}”`);
      signalKeys.push('dyspnea');
    }
    if (dizziness) {
      evidence.push(`主诉：${dizziness.date} 说“${dizziness.text}”`);
      signalKeys.push('dizziness');
    }
    if (poorSleep) {
      evidence.push(`主诉：${poorSleep.date} 说“${poorSleep.text}”`);
      signalKeys.push('poorSleep');
    }
    if (edema) {
      evidence.push(`主诉：${edema.date} 说“${edema.text}”`);
      signalKeys.push('edema');
    }
    if (weight && weight.badRatio >= 0.015) {
      evidence.push(
        `体重：最近平均 ${fmt('weight', weight.recentMean)}，较个人基线增加 ${(weight.recentMean - weight.baselineMean).toFixed(1)} kg`,
      );
      signalKeys.push('weight');
    }
    if (wakes && wakes.badRatio >= 0.5) {
      evidence.push(
        `夜间醒来：平均 ${wakes.recentMean.toFixed(1)} 次，较个人基线增加约 ${Math.round(wakes.badRatio * 100)}%`,
      );
      signalKeys.push('nightWakes');
    }
    if (sleepHours && sleepHours.badRatio >= 0.15) {
      evidence.push(
        `睡眠时长：平均 ${fmt('sleepHours', sleepHours.recentMean)}，比基线少约 ${Math.round(sleepHours.badRatio * 100)}%`,
      );
      signalKeys.push('sleepHours');
    }
    if (hr && hr.badRatio >= 0.05) {
      evidence.push(
        `静息心率：平均 ${fmt('restingHr', hr.recentMean)}，比个人基线高约 ${Math.round(hr.recentMean - hr.baselineMean)} bpm`,
      );
      signalKeys.push('restingHr');
    }
    if (spo2 && spo2.badRatio >= 0.02) {
      evidence.push(`血氧：平均 ${fmt('spo2', spo2.recentMean)}，比个人基线低约 ${Math.round(spo2.badRatio * 100)}%`);
      signalKeys.push('spo2');
    }

    return addFinding(context.findings, {
      date: context.today,
      severity: 'alert',
      title: '多个信号同时出现变化，建议关注整体状态',
      detail:
        '把最近几天的活动、身体感受和客观测量放在一起看，出现了多个方向一致的变化。这不是疾病诊断，但已经不太像一次普通波动，建议今天和家人/随访医生沟通一下。',
      evidence,
      familyMessage: familyEligible
        ? `【建议关注】${context.today}：最近有 ${categories} 个维度同时发生变化，建议今天联系老人确认状态，必要时咨询随访医生。`
        : undefined,
      carePath:
        '今天联系老人确认是否有持续加重；如症状明显或持续，联系社区/随访医生；出现急性危险症状时按急救路径处理。',
      ruleId: 'fusion.multisignal_deterioration',
      score: categories,
      signalKeys: [...new Set(signalKeys)],
      familyEligible,
    });
  },
};
