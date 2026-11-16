import { addFinding } from '../helpers';
import { fmt, hadOccurredObservation, hadTag } from '../signals';
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
      familyMessage:
        withEdema && familyEligible
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

/**
 * 发热、心慌、体重下降先进入“记录并观察”，不凭一句话升级家属告警。
 * 真正的升级由体温/心率等结构化读数或伴发危险症状决定；这里只保证这些
 * 老人明确说出的信号不会像旧版一样被静默丢弃。
 */
export const feverReminderRule: DetectionRule = {
  id: 'symptom.fever.reminder',
  evaluate(context) {
    const fever = hadOccurredObservation(context.observations, 'fever', context.today, context.config.recentDays);
    if (!fever) return null;
    return addFinding(context.findings, {
      date: context.today,
      severity: 'watch',
      title: '您提到发热',
      detail:
        '先记录体温、测量时间和伴随症状，多喝水、注意休息。体温持续升高、反复三天以上，或伴喘、意识不清、明显虚弱时，尽快联系医生。这不是诊断。',
      evidence: [`${fever.date} 说“${fever.text}”`],
      carePath: '记录体温和测量时间；持续或加重时联系医生。',
      ruleId: 'symptom.fever.reminder',
      score: 1,
      signalKeys: ['fever'],
      familyEligible: fever.visibility !== 'private',
    });
  },
};

export const palpitationsReminderRule: DetectionRule = {
  id: 'symptom.palpitations.reminder',
  evaluate(context) {
    const palpitations = hadOccurredObservation(
      context.observations,
      'palpitations',
      context.today,
      context.config.recentDays,
    );
    if (!palpitations) return null;
    return addFinding(context.findings, {
      date: context.today,
      severity: 'watch',
      title: '您提到心慌/心悸',
      detail:
        '先坐下休息，记录持续时间和当时在做什么。如果同时出现胸痛、喘、晕倒或明显乏力，不要在家继续观察，立即联系家人或急救。',
      evidence: [`${palpitations.date} 说“${palpitations.text}”`],
      carePath: '休息后复测心率；反复出现或伴胸痛、晕厥、呼吸困难时尽快就医。',
      ruleId: 'symptom.palpitations.reminder',
      score: 1,
      signalKeys: ['palpitations'],
      familyEligible: palpitations.visibility !== 'private',
    });
  },
};

export const weightLossReminderRule: DetectionRule = {
  id: 'weight.short_term_loss',
  evaluate(context) {
    const weightLoss = hadOccurredObservation(context.observations, 'weightLoss', context.today, 14);
    if (!weightLoss) return null;
    return addFinding(context.findings, {
      date: context.today,
      severity: 'watch',
      title: '您提到近期体重下降',
      detail:
        '体重短期下降的原因很多，先确认饮食、活动和测量方式有没有变化，并继续规律称重。如果持续下降或伴乏力、食欲差、发热等表现，建议尽快和医生核对。这不是诊断。',
      evidence: [`${weightLoss.date} 说“${weightLoss.text}”`],
      carePath: '继续规律称重并记录饮食变化；持续下降或伴其他不适时联系医生。',
      ruleId: 'weight.short_term_loss',
      score: 1,
      signalKeys: ['weightLoss'],
      familyEligible: weightLoss.visibility !== 'private',
    });
  },
};

export const contextualRules: DetectionRule[] = [
  nightWakesRule,
  weightRiseRule,
  fatigueReminderRule,
  feverReminderRule,
  palpitationsReminderRule,
  weightLossReminderRule,
];
