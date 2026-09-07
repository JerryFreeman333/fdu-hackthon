import { addFinding } from '../helpers';
import { fmt, hadTag } from '../signals';
import type { DetectionRule } from '../types';

export const nightWakesRule: DetectionRule = {
  id: 'sleep.night_wakes.baseline_shift',
  evaluate(context) {
    const signal = context.signals.get('nightWakes');
    if (!signal || signal.badRatio < 0.5 || signal.recentMean < 2) return null;
    return addFinding(context.findings, {
      date: context.today,
      severity: 'watch',
      title: '夜间醒来次数比平时明显增加',
      detail: '最近夜里醒来的次数增加了。起夜时记得开灯、慢慢走，避免摔倒。',
      evidence: [
        `最近${context.config.recentDays}天中有 ${signal.recentN} 天数据，平均 ${signal.recentMean.toFixed(1)} 次，个人基线约 ${signal.baselineMean.toFixed(1)} 次`,
        `相对个人基线增加约 ${Math.round(signal.badRatio * 100)}%`,
      ],
      ruleId: 'sleep.night_wakes.baseline_shift',
      score: 1 + signal.badRatio,
      signalKeys: ['nightWakes'],
    });
  },
};

export const weightRiseRule: DetectionRule = {
  id: 'weight.short_term_rise',
  evaluate(context) {
    const signal = context.signals.get('weight');
    const edema = hadTag(context.observations, 'edema', context.today, context.config.recentDays);
    if (!signal || signal.recentMean - signal.baselineMean < 1.0) return null;

    const delta = signal.recentMean - signal.baselineMean;
    const withEdema = edema !== null && delta >= 1.2;
    const familyEligible = edema === null || edema.visibility !== 'private';
    return addFinding(context.findings, {
      date: context.today,
      severity: withEdema ? 'alert' : 'watch',
      title: '最近几天体重变化较快',
      detail: withEdema
        ? '体重在短时间内明显上升，同时您提到脚踝/腿部有水肿。这不是诊断，但两类变化叠加值得尽快和家人、医生沟通。'
        : '这几天体重变化比较快。短时间变化的原因很多，先继续规律测量，不要只根据一次称重下结论。',
      evidence: [
        `最近${context.config.recentDays}天中有 ${signal.recentN} 天数据，平均体重 ${fmt('weight', signal.recentMean)}，比个人基线高 ${delta.toFixed(1)} kg`,
        ...(edema && familyEligible ? [`主诉：${edema.date} 说“${edema.text}”`] : []),
      ],
      familyMessage: withEdema && familyEligible
        ? `【建议关注】${context.today}：近几天体重较个人基线高 ${delta.toFixed(1)} kg，同时老人提到水肿，建议今天联系老人确认状态，并考虑咨询医生。`
        : undefined,
      carePath: withEdema ? '今天联系老人确认状态；如症状继续加重，联系社区/随访医生。' : undefined,
      ruleId: 'weight.short_term_rise',
      score: withEdema ? 3 : 1,
      signalKeys: ['weight', ...(edema ? ['edema'] : [])],
      familyEligible,
    });
  },
};

export const fatigueReminderRule: DetectionRule = {
  id: 'symptom.fatigue.reminder',
  evaluate(context) {
    const fatigue = hadTag(context.observations, 'fatigue', context.today, context.config.recentDays);
    const alreadyFused = context.findings.some((finding) => finding.ruleId === 'fusion.multisignal_deterioration');
    if (!fatigue || alreadyFused) return null;
    return addFinding(context.findings, {
      date: context.today,
      severity: 'info',
      title: '您提到最近比较累',
      detail: '先休息好。如果这种疲惫持续几天，或者活动后越来越喘，继续告诉我。',
      evidence: [`${fatigue.date} 说“${fatigue.text}”`],
      ruleId: 'symptom.fatigue.reminder',
      score: 1,
      signalKeys: ['fatigue'],
      familyEligible: fatigue.visibility !== 'private',
    });
  },
};

export const contextualRules: DetectionRule[] = [nightWakesRule, weightRiseRule, fatigueReminderRule];
