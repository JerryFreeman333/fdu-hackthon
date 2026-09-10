import type { Observation } from '../../types';
import { addFinding } from './helpers';
import { hadTag } from './signals';
import type { DetectionContext, DetectionRule } from './types';

function tagText(observation: Observation): string {
  return `${observation.date}：${observation.text}`;
}

function familyEligible(...observations: Array<Observation | null>): boolean {
  return observations.every((observation) => observation === null || observation.visibility !== 'private');
}

function hasPrivateTodayMeasurement(context: DetectionContext, metric: 'systolic' | 'diastolic'): boolean {
  return context.measurements.some(
    (measurement) =>
      measurement.metric === metric &&
      measurement.visibility === 'private' &&
      measurement.timestamp.slice(0, 10) === context.today,
  );
}

interface BloodPressureSafetySnapshot {
  maxSystolic?: number;
  maxDiastolic?: number;
  severe: boolean;
}

function todayBloodPressureSafetySnapshot(context: DetectionContext): BloodPressureSafetySnapshot {
  let maxSystolic: number | undefined;
  let maxDiastolic: number | undefined;
  for (const measurement of context.measurements) {
    if (measurement.timestamp.slice(0, 10) !== context.today) continue;
    if (measurement.metric === 'systolic') maxSystolic = Math.max(maxSystolic ?? -Infinity, measurement.value);
    if (measurement.metric === 'diastolic') maxDiastolic = Math.max(maxDiastolic ?? -Infinity, measurement.value);
  }
  return {
    maxSystolic,
    maxDiastolic,
    severe: (maxSystolic !== undefined && maxSystolic > 180) || (maxDiastolic !== undefined && maxDiastolic > 120),
  };
}

export const bloodPressureSafetyRule: DetectionRule = {
  id: 'safety.blood_pressure.severe_reading',
  evaluate(context) {
    // 安全规则必须检查当天全部原始测量，而不能只读取 DayRecord 的“最新代表值”。
    // 否则“210 → 170”的复测会把此前的危险读数从安全引擎里抹掉。
    const { maxSystolic, maxDiastolic, severe } = todayBloodPressureSafetySnapshot(context);
    if (!severe) return null;

    const dyspnea = hadTag(context.observations, 'dyspnea', context.today, 1);
    const chestPain = hadTag(context.observations, 'chestPain', context.today, 1);
    const neuroChange = hadTag(context.observations, 'neuroChange', context.today, 1);
    const danger = dyspnea ?? chestPain ?? neuroChange;
    const urgent = danger !== null;
    const shareableSymptoms = familyEligible(dyspnea, chestPain, neuroChange);
    const privateBp =
      hasPrivateTodayMeasurement(context, 'systolic') || hasPrivateTodayMeasurement(context, 'diastolic');
    const shareable = shareableSymptoms && !privateBp;
    const evidence = [
      ...(maxSystolic !== undefined ? [`今日收缩压最高 ${maxSystolic} mmHg`] : []),
      ...(maxDiastolic !== undefined ? [`今日舒张压最高 ${maxDiastolic} mmHg`] : []),
      ...(dyspnea && shareableSymptoms ? [`今日呼吸不适：${tagText(dyspnea)}`] : []),
      ...(chestPain && shareableSymptoms ? [`今日胸痛：${tagText(chestPain)}`] : []),
      ...(neuroChange && shareableSymptoms ? [`今日突发神经系统异常：${tagText(neuroChange)}`] : []),
    ];

    return addFinding(context.findings, {
      date: context.today,
      severity: urgent ? 'urgent' : 'alert',
      title: urgent ? '血压非常高且伴随危险症状' : '血压读数非常高，需要马上复测',
      detail: urgent
        ? '先停止活动、坐下休息，不要自行加倍服药。立即再次测量；如果复测仍很高，或胸痛、呼吸困难、突发神经系统异常等症状持续，应立即寻求急救。'
        : '当天出现过一次或多次非常高的读数。先安静坐下，按规范重新测量；如果复测仍很高，应尽快联系医疗专业人员。',
      evidence,
      familyMessage: shareable
        ? urgent
          ? `【紧急】${context.today}：老人今日曾出现超过 180/120 mmHg 的血压读数，并伴危险症状，请立即联系老人；复测仍高或症状明显时立即寻求急救。`
          : `【请立即关注】${context.today}：老人今日曾出现超过 180/120 mmHg 的血压读数，请帮助其安静休息并复测；若仍高，请尽快联系医疗人员。`
        : undefined,
      carePath: urgent
        ? '立即联系老人；复测仍高且出现胸痛、呼吸困难、意识/语言/肢体异常等危险症状时，立即拨打当地急救电话。'
        : '安静坐下后按规范复测；如果当天曾出现 >180/120 mmHg 的读数，复测仍高时尽快联系医疗人员。',
      ruleId: 'safety.blood_pressure.severe_reading',
      score: urgent ? 5 : 4,
      signalKeys: [
        'systolic',
        'diastolic',
        ...(danger
          ? danger.tags.filter((tag) => tag === 'dyspnea' || tag === 'chestPain' || tag === 'neuroChange')
          : []),
      ],
      familyEligible: shareable,
    });
  },
};

export const redFlagSymptomRule: DetectionRule = {
  id: 'safety.red_flag_symptom',
  evaluate(context) {
    const severeBp = todayBloodPressureSafetySnapshot(context).severe;
    if (severeBp) return null;

    const chestPain = hadTag(context.observations, 'chestPain', context.today, 1);
    const neuroChange = hadTag(context.observations, 'neuroChange', context.today, 1);
    if (!chestPain && !neuroChange) return null;
    const shareable = familyEligible(chestPain, neuroChange);
    const keys = [...(chestPain ? ['chestPain'] : []), ...(neuroChange ? ['neuroChange'] : [])];
    return addFinding(context.findings, {
      date: context.today,
      severity: 'urgent',
      title:
        keys.length > 1
          ? '出现多项突发危险症状，需要立即处理'
          : keys[0] === 'chestPain'
            ? '出现胸痛，需要立即确认情况'
            : '出现突发神经系统异常，需要立即处理',
      detail: chestPain
        ? '先停止活动并保持安全姿势。胸痛如果明显或持续，尤其伴呼吸困难、冷汗、头晕等情况，不要在家继续观察，应立即寻求急救。'
        : '突然出现说话异常、脸部歪斜或一侧肢体无力等情况，不要在家继续观察，应立即寻求急救。',
      evidence: [
        ...(chestPain && shareable ? [tagText(chestPain)] : []),
        ...(neuroChange && shareable ? [tagText(neuroChange)] : []),
      ],
      familyMessage: shareable
        ? `【紧急】${context.today}：老人报告${keys.length > 1 ? '突发胸痛及/或神经系统异常' : keys[0] === 'chestPain' ? '胸痛' : '突发神经系统异常'}，请立即联系老人并按急救路径处理。`
        : undefined,
      carePath: '立即联系老人；如症状持续、明显或伴其他危险表现，立即拨打当地急救电话。',
      ruleId: 'safety.red_flag_symptom',
      score: 5,
      signalKeys: keys,
      familyEligible: shareable,
    });
  },
};

export const fallSafetyRule: DetectionRule = {
  id: 'safety.fall',
  evaluate(context) {
    const fall = hadTag(context.observations, 'fall', context.today, 1);
    if (!fall) return null;
    const shareable = fall.visibility !== 'private';
    return addFinding(context.findings, {
      date: context.today,
      severity: 'urgent',
      title: '发生跌倒，需要立即确认情况',
      detail: '跌倒后先别急着起身，先确认有没有明显疼痛、出血、意识异常或无法站立。必要时立即寻求急救。',
      evidence: [shareable ? tagText(fall) : '老人报告发生跌倒（具体聊天内容未共享）。'],
      familyMessage: shareable
        ? `【紧急】${context.today}：老人报告刚刚跌倒，请立即联系老人确认是否受伤，必要时拨打当地急救电话。`
        : undefined,
      carePath: '立即确认安全；如无法站立、明显受伤、意识异常或情况严重，立即拨打当地急救电话。',
      ruleId: 'safety.fall',
      score: 5,
      signalKeys: ['fall'],
      familyEligible: shareable,
    });
  },
};
