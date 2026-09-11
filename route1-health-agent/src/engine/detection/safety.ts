import type { Observation } from '../../types';
import { addFinding } from './helpers';
import { hadOccurredObservation } from './signals';
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

function peakTodayBloodPressure(context: DetectionContext): { systolic?: number; diastolic?: number } {
  const systolicValues = context.measurements
    .filter((measurement) => measurement.metric === 'systolic' && measurement.timestamp.slice(0, 10) === context.today)
    .map((measurement) => measurement.value);
  const diastolicValues = context.measurements
    .filter((measurement) => measurement.metric === 'diastolic' && measurement.timestamp.slice(0, 10) === context.today)
    .map((measurement) => measurement.value);

  return {
    systolic: systolicValues.length > 0 ? Math.max(...systolicValues) : undefined,
    diastolic: diastolicValues.length > 0 ? Math.max(...diastolicValues) : undefined,
  };
}

export const bloodPressureSafetyRule: DetectionRule = {
  id: 'safety.blood_pressure.severe_reading',
  evaluate(context) {
    const peak = peakTodayBloodPressure(context);
    const severe =
      (peak.systolic !== undefined && peak.systolic > 180) || (peak.diastolic !== undefined && peak.diastolic > 120);
    if (!severe) return null;

    const today = context.records.find((r) => r.date === context.today);
    const systolic = today?.metrics.systolic;
    const diastolic = today?.metrics.diastolic;
    const dyspnea = hadOccurredObservation(context.observations, 'dyspnea', context.today, 1);
    const chestPain = hadOccurredObservation(context.observations, 'chestPain', context.today, 1);
    const neuroChange = hadOccurredObservation(context.observations, 'neuroChange', context.today, 1);
    const danger = dyspnea ?? chestPain ?? neuroChange;
    const urgent = danger !== null;
    const shareableSymptoms = familyEligible(dyspnea, chestPain, neuroChange);
    const privateBp =
      hasPrivateTodayMeasurement(context, 'systolic') || hasPrivateTodayMeasurement(context, 'diastolic');
    const shareable = shareableSymptoms && !privateBp;

    return addFinding(context.findings, {
      date: context.today,
      severity: urgent ? 'urgent' : 'alert',
      title: urgent ? '血压非常高且伴随危险症状' : '血压读数非常高，需要马上复测',
      detail: urgent
        ? '先停止活动、坐下休息，不要自行加倍服药。立即再次测量；如果复测仍很高，或胸痛、呼吸困难、突发神经系统异常等症状持续，应立即寻求急救。'
        : '单次高读数不能直接下结论。先安静坐下，至少一分钟后按规范重新测量；如果复测仍很高，应尽快联系医疗专业人员。',
      evidence: [
        `今日峰值血压 ${peak.systolic ?? systolic ?? '—'}/${peak.diastolic ?? diastolic ?? '—'} mmHg`,
        ...(dyspnea && shareableSymptoms ? [`今日呼吸不适：${tagText(dyspnea)}`] : []),
        ...(chestPain && shareableSymptoms ? [`今日胸痛：${tagText(chestPain)}`] : []),
        ...(neuroChange && shareableSymptoms ? [`今日突发神经系统异常：${tagText(neuroChange)}`] : []),
      ],
      familyMessage: shareable
        ? urgent
          ? `【紧急】${context.today}：老人今日血压读数超过 180/120 mmHg，并伴危险症状，请立即联系老人；复测仍高或症状明显时立即寻求急救。`
          : `【请立即关注】${context.today}：老人今日血压读数超过 180/120 mmHg，请帮助其安静休息并复测；若仍高，请尽快联系医疗人员。`
        : undefined,
      carePath: urgent
        ? '立即联系老人；复测仍高且出现胸痛、呼吸困难、意识/语言/肢体异常等危险症状时，立即拨打当地急救电话。'
        : '安静坐下至少 1 分钟后复测；仍然 >180/120 mmHg 时尽快联系医疗人员。',
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
    const today = context.records.find((r) => r.date === context.today);
    const systolic = today?.metrics.systolic;
    const diastolic = today?.metrics.diastolic;
    const severeBp = (systolic !== undefined && systolic > 180) || (diastolic !== undefined && diastolic > 120);
    if (severeBp) return null;

    const chestPain = hadOccurredObservation(context.observations, 'chestPain', context.today, 1);
    const neuroChange = hadOccurredObservation(context.observations, 'neuroChange', context.today, 1);
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

function peakTodayMetric(context: DetectionContext, metric: 'spo2' | 'restingHr' | 'bloodGlucose'): number | undefined {
  const values = context.measurements
    .filter((m) => m.metric === metric && m.timestamp.slice(0, 10) === context.today)
    .map((m) => m.value);
  if (values.length === 0) return undefined;
  // spo2 取最小, 其余取最大 (higherIsBad)
  if (metric === 'spo2') return Math.min(...values);
  return Math.max(...values);
}

function familyEligibleMeasurements(context: DetectionContext, metric: 'spo2' | 'restingHr' | 'bloodGlucose'): boolean {
  return context.measurements.some(
    (m) => m.metric === metric && m.timestamp.slice(0, 10) === context.today && m.visibility !== 'private',
  );
}

export const spo2SafetyRule: DetectionRule = {
  id: 'safety.spo2.low',
  evaluate(context) {
    const peak = peakTodayMetric(context, 'spo2');
    if (peak === undefined) return null;
    const urgent = peak < 88;
    const alert = peak < 92;
    if (!alert) return null;
    const dyspnea = hadOccurredObservation(context.observations, 'dyspnea', context.today, 1);
    const shareable =
      familyEligibleMeasurements(context, 'spo2') && (dyspnea ? dyspnea.visibility !== 'private' : true);
    return addFinding(context.findings, {
      date: context.today,
      severity: urgent ? 'urgent' : 'alert',
      title: urgent ? '血氧极低，需要立即确认' : '血氧偏低，建议复测并观察',
      detail: urgent
        ? '血氧低到危险水平。请立即坐下、不要独自活动；如伴呼吸困难、胸痛、嘴唇发紫或意识变化，立即寻求急救。'
        : '血氧低于个人平时。按设备说明复测一次，保持手部温暖；如持续走低或伴呼吸困难，及时联系医疗人员。',
      evidence: [
        `今日最低血氧 ${peak} %`,
        ...(dyspnea && dyspnea.visibility !== 'private' ? [`今日呼吸不适：${tagText(dyspnea)}`] : []),
      ],
      familyMessage: shareable
        ? urgent
          ? `【紧急】${context.today}：老人今日血氧读数低于 88%，请立即联系老人并按急救路径处理。`
          : `【请关注】${context.today}：老人今日血氧读数低于 92%，请帮助复测并留意呼吸情况。`
        : undefined,
      carePath: urgent
        ? '立即联系老人；如伴明显呼吸困难、嘴唇发紫或意识变化，立即拨打当地急救电话。'
        : '按设备说明复测；仍低于 92% 或出现呼吸困难，尽快联系医疗人员。',
      ruleId: 'safety.spo2.low',
      score: urgent ? 5 : 4,
      signalKeys: ['spo2', ...(dyspnea ? ['dyspnea'] : [])],
      familyEligible: shareable,
    });
  },
};

export const heartRateSafetyRule: DetectionRule = {
  id: 'safety.heart_rate.extreme',
  evaluate(context) {
    const peak = peakTodayMetric(context, 'restingHr');
    if (peak === undefined) return null;
    const tachyExtreme = peak >= 140;
    const tachyAlert = peak >= 120;
    const bradyExtreme = peak <= 40;
    const bradyAlert = peak <= 50;
    if (!(tachyAlert || bradyAlert)) return null;
    const chestPain = hadOccurredObservation(context.observations, 'chestPain', context.today, 1);
    const dizziness = hadOccurredObservation(context.observations, 'dizziness', context.today, 1);
    const danger = chestPain ?? dizziness;
    const urgent = tachyExtreme || bradyExtreme || danger !== null;
    const shareable = familyEligibleMeasurements(context, 'restingHr') && (!danger || danger.visibility !== 'private');
    const dir = tachyAlert ? 'fast' : 'slow';
    return addFinding(context.findings, {
      date: context.today,
      severity: urgent ? 'urgent' : 'alert',
      title: urgent
        ? dir === 'fast'
          ? '静息心率极快，需要立即确认'
          : '静息心率极慢，需要立即确认'
        : dir === 'fast'
          ? '静息心率偏快，建议复测'
          : '静息心率偏慢，建议复测',
      detail: urgent
        ? dir === 'fast'
          ? '安静时心跳过快，伴胸痛、头晕或明显不舒服时不要硬撑，立即联系老人并按急救路径处理。'
          : '安静时心跳过慢，伴头晕、意识模糊或站不稳时立即寻求帮助。'
        : '按设备说明复测一次；持续异常或伴不舒服时及时联系医疗人员。',
      evidence: [
        `今日心率峰值 ${peak} bpm`,
        ...(danger && danger.visibility !== 'private'
          ? [`今日${danger.tags.includes('chestPain') ? '胸痛' : '头晕'}：${tagText(danger)}`]
          : []),
      ],
      familyMessage: shareable
        ? urgent
          ? `【紧急】${context.today}：老人今日心率${dir === 'fast' ? '过快' : '过慢'}（峰值 ${peak} bpm），请立即联系老人确认情况。`
          : `【请关注】${context.today}：老人今日心率${dir === 'fast' ? '持续偏快' : '持续偏慢'}（峰值 ${peak} bpm），请帮助复测。`
        : undefined,
      carePath: urgent
        ? '立即联系老人；伴胸痛、严重头晕或意识变化时立即拨打当地急救电话。'
        : '复测后仍异常或伴不舒服时尽快联系医疗人员。',
      ruleId: 'safety.heart_rate.extreme',
      score: urgent ? 5 : 4,
      signalKeys: ['restingHr', ...(danger ? danger.tags : [])],
      familyEligible: shareable,
    });
  },
};

export const glucoseSafetyRule: DetectionRule = {
  id: 'safety.blood_glucose.extreme',
  evaluate(context) {
    const peak = peakTodayMetric(context, 'bloodGlucose');
    if (peak === undefined) return null;
    // 低血糖优先 (危险): < 3.5 紧急, < 3.9 alert; 高血糖: > 16.7 紧急, > 13.9 alert
    const lowUrgent = peak < 3.5;
    const lowAlert = peak < 3.9;
    const highUrgent = peak > 16.7;
    const highAlert = peak > 13.9;
    if (!(lowAlert || highAlert)) return null;
    const urgent = lowUrgent || highUrgent;
    const shareable = familyEligibleMeasurements(context, 'bloodGlucose');
    const dir = lowAlert ? 'low' : 'high';
    return addFinding(context.findings, {
      date: context.today,
      severity: urgent ? 'urgent' : 'alert',
      title: urgent
        ? dir === 'low'
          ? '血糖极低，需要立即处理'
          : '血糖明显偏高，需要立即确认'
        : dir === 'low'
          ? '血糖偏低，按低血糖路径处理'
          : '血糖偏高，建议复测并联系医生',
      detail: urgent
        ? dir === 'low'
          ? '低血糖可快速进展为意识模糊。请立即按医生方案补糖，15 分钟内复测；如出现意识变化、抽搐，立即寻求急救。'
          : '血糖明显偏高并伴口渴、乏力或意识变化时不要硬扛，立即联系医疗人员。'
        : dir === 'low'
          ? '按低血糖路径补糖，15 分钟后再测一次，避免空腹剧烈活动；反复出现及时联系医生。'
          : '复测一次确认测量时间和是否空腹；持续偏高或伴不舒服时及时联系医生。',
      evidence: [`今日血糖 ${peak} mmol/L`],
      familyMessage: shareable
        ? urgent
          ? `【紧急】${context.today}：老人今日血糖读数${dir === 'low' ? '过低' : '明显偏高'}（${peak} mmol/L），请立即联系老人按医生方案处理。`
          : `【请关注】${context.today}：老人今日血糖${dir === 'low' ? '偏低' : '偏高'}（${peak} mmol/L），请帮助复测并按医生方案处理。`
        : undefined,
      carePath: urgent
        ? '立即联系老人按医生方案处理；如出现意识变化、抽搐或严重不适，立即拨打当地急救电话。'
        : '复测一次确认测量时间和是否空腹；持续异常或伴不舒服时及时联系医疗人员。',
      ruleId: 'safety.blood_glucose.extreme',
      score: urgent ? 5 : 4,
      signalKeys: ['bloodGlucose'],
      familyEligible: shareable,
    });
  },
};

export const fallSafetyRule: DetectionRule = {
  id: 'safety.fall',
  evaluate(context) {
    const fall = hadOccurredObservation(context.observations, 'fall', context.today, 1);
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
