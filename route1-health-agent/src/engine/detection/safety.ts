import type { HealthMeasurement, Observation, TemperatureSite } from '../../types';
import { addFinding } from './helpers';
import { hadOccurredObservation } from './signals';
import type { DetectionContext, DetectionRule } from './types';
import {
  compareTemperatureGrade,
  classifyTemperature,
  measurementTemperatureSite,
  temperatureBand,
  type TemperatureBand,
  type TemperatureGrade,
} from './temperatureBands';

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

/**
 * P0：低血压方向。旧规则只拦 >180/120，把 95/60 + 站起来发黑当成“血压偏高”
 * 记了一条普通读数，既不解释症状也不提醒家属。这里按最低读数判断低方向，
 * 并把“伴头晕/晕厥/胸痛/喘”作为升级条件；阈值不是诊断，只用于安全分流。
 */
export const lowBloodPressureSafetyRule: DetectionRule = {
  id: 'safety.blood_pressure.low',
  evaluate(context) {
    const readings = context.measurements.filter(
      (measurement) =>
        (measurement.metric === 'systolic' || measurement.metric === 'diastolic') &&
        measurement.timestamp.slice(0, 10) === context.today,
    );
    if (readings.length === 0) return null;

    const systolicValues = readings.filter((item) => item.metric === 'systolic').map((item) => item.value);
    const diastolicValues = readings.filter((item) => item.metric === 'diastolic').map((item) => item.value);
    const systolic = systolicValues.length > 0 ? Math.min(...systolicValues) : undefined;
    const diastolic = diastolicValues.length > 0 ? Math.min(...diastolicValues) : undefined;
    const strictLow = (systolic !== undefined && systolic < 90) || (diastolic !== undefined && diastolic < 60);

    const dizziness = hadOccurredObservation(context.observations, 'dizziness', context.today, 1);
    const syncope = hadOccurredObservation(context.observations, 'syncope', context.today, 1);
    const chestPain = hadOccurredObservation(context.observations, 'chestPain', context.today, 1);
    const dyspnea = hadOccurredObservation(context.observations, 'dyspnea', context.today, 1);
    const symptomatic = dizziness ?? syncope ?? chestPain ?? dyspnea;
    // 95/60 不满足 <90/60 的严格阈值，但“站起来发黑”说明体位性症状已经出现。
    // 只在有症状时把临界低值升级成可解释的提醒，不凭一个数字制造警报。
    const borderlineLow =
      ((systolic !== undefined && systolic < 100) || (diastolic !== undefined && diastolic < 65)) &&
      symptomatic !== null;
    if (!strictLow && !borderlineLow) return null;

    const urgent = strictLow && symptomatic !== null;
    const shareableSymptoms = familyEligible(dizziness, syncope, chestPain, dyspnea);
    const privateBp = readings.some((measurement) => measurement.visibility === 'private');
    const shareable = shareableSymptoms && !privateBp;
    const rangeText =
      systolic !== undefined && diastolic !== undefined
        ? `${systolic}/${diastolic} mmHg`
        : systolic !== undefined
          ? `收缩压 ${systolic} mmHg`
          : `舒张压 ${diastolic} mmHg`;

    return addFinding(context.findings, {
      date: context.today,
      severity: urgent ? 'urgent' : 'alert',
      title: urgent ? '血压偏低并伴不适，需要立即确认' : '血压读数偏低，需要复测并观察症状',
      detail: urgent
        ? '今天记录到的血压偏低，同时老人报告头晕、晕厥、胸痛或喘。先让老人坐下或平躺，不要独自站起或走动；复测一次，若意识不清、反复晕厥、胸痛或呼吸困难，立即寻求急救。这不是诊断。'
        : '今天记录到的血压偏低。先坐下休息后按设备说明复测，并留意站起来是否发黑、头晕或站不稳；如果症状持续或加重，请联系医疗人员。单次读数不能自行下诊断。',
      evidence: [
        `今日最低血压 ${rangeText}`,
        ...(dizziness && shareableSymptoms ? [`今日头晕：${tagText(dizziness)}`] : []),
        ...(syncope && shareableSymptoms ? [`今日晕厥：${tagText(syncope)}`] : []),
        ...(chestPain && shareableSymptoms ? [`今日胸痛：${tagText(chestPain)}`] : []),
        ...(dyspnea && shareableSymptoms ? [`今日呼吸不适：${tagText(dyspnea)}`] : []),
      ],
      familyMessage: shareable
        ? urgent
          ? `【紧急】${context.today}：老人今日血压偏低（最低 ${rangeText}），并伴头晕/晕厥/胸痛/呼吸不适。请立即联系老人，确认意识与站立安全；症状明显时立即寻求急救。`
          : `【请关注】${context.today}：老人今日血压读数偏低（最低 ${rangeText}）。请帮助其坐下复测，并确认站起时是否头晕、发黑或站不稳。`
        : undefined,
      carePath: urgent
        ? '立即联系老人；先坐下或平躺，复测血压并确认意识、胸痛和呼吸情况；出现意识不清、反复晕厥、胸痛或呼吸困难时立即拨打当地急救电话。'
        : '坐下休息后复测；站起时动作放慢。症状持续、加重或反复出现时联系医疗人员。',
      ruleId: 'safety.blood_pressure.low',
      score: urgent ? 5 : 3,
      signalKeys: ['systolic', 'diastolic', ...(symptomatic ? symptomatic.tags : [])],
      familyEligible: shareable,
    });
  },
};

/** 当日该指标的全部读数范围。低方向（低血糖/心动过缓）看 min，高方向看 max，互不掩盖。 */
function todayMetricExtremes(
  context: DetectionContext,
  metric: 'spo2' | 'restingHr' | 'bloodGlucose' | 'temperature',
): { min: number; max: number } | undefined {
  const values = context.measurements
    .filter((m) => m.metric === metric && m.timestamp.slice(0, 10) === context.today)
    .map((m) => m.value);
  if (values.length === 0) return undefined;
  return { min: Math.min(...values), max: Math.max(...values) };
}

function familyEligibleMeasurements(
  context: DetectionContext,
  metric: 'spo2' | 'restingHr' | 'bloodGlucose' | 'temperature',
): boolean {
  return context.measurements.some(
    (m) => m.metric === metric && m.timestamp.slice(0, 10) === context.today && m.visibility !== 'private',
  );
}

export const spo2SafetyRule: DetectionRule = {
  id: 'safety.spo2.low',
  evaluate(context) {
    const lowest = todayMetricExtremes(context, 'spo2')?.min;
    if (lowest === undefined) return null;
    const urgent = lowest < 88;
    const alert = lowest < 92;
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
        `今日最低血氧 ${lowest} %`,
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
    const extremes = todayMetricExtremes(context, 'restingHr');
    if (!extremes) return null;
    const fastest = extremes.max;
    const slowest = extremes.min;
    // 快/慢两个方向分别对照当日最高/最低读数，避免一次正常读数掩盖同日的心动过缓。
    const tachyExtreme = fastest >= 140;
    const tachyAlert = fastest >= 120;
    const bradyExtreme = slowest <= 40;
    const bradyAlert = slowest <= 50;
    if (!(tachyAlert || bradyAlert)) return null;
    const chestPain = hadOccurredObservation(context.observations, 'chestPain', context.today, 1);
    const dizziness = hadOccurredObservation(context.observations, 'dizziness', context.today, 1);
    const danger = chestPain ?? dizziness;
    const urgent = tachyExtreme || bradyExtreme || danger !== null;
    const shareable = familyEligibleMeasurements(context, 'restingHr') && (!danger || danger.visibility !== 'private');
    const dir = tachyAlert && bradyAlert ? 'both' : tachyAlert ? 'fast' : 'slow';
    const rangeText =
      slowest === fastest
        ? `${slowest}`
        : dir === 'both'
          ? `最低 ${slowest}、最高 ${fastest}`
          : dir === 'fast'
            ? `最高 ${fastest}`
            : `最低 ${slowest}`;
    return addFinding(context.findings, {
      date: context.today,
      severity: urgent ? 'urgent' : 'alert',
      title: urgent
        ? dir === 'fast'
          ? '静息心率极快，需要立即确认'
          : dir === 'slow'
            ? '静息心率极慢，需要立即确认'
            : '静息心率快慢波动大，需要立即确认'
        : dir === 'fast'
          ? '静息心率偏快，建议复测'
          : dir === 'slow'
            ? '静息心率偏慢，建议复测'
            : '静息心率快慢波动大，建议复测',
      detail: urgent
        ? dir === 'fast'
          ? '安静时心跳过快，伴胸痛、头晕或明显不舒服时不要硬撑，立即联系老人并按急救路径处理。'
          : dir === 'slow'
            ? '安静时心跳过慢，伴头晕、意识模糊或站不稳时立即寻求帮助。'
            : '安静时心率快慢波动明显，伴胸痛、头晕或站不稳时不要硬撑，立即联系老人并按急救路径处理。'
        : dir === 'both'
          ? '今天同时记录到偏快和偏慢的心率。按设备说明规范复测并记下时间；持续波动或伴不舒服时及时联系医疗人员。'
          : '按设备说明复测一次；持续异常或伴不舒服时及时联系医疗人员。',
      evidence: [
        `今日心率 ${rangeText} bpm`,
        ...(danger && danger.visibility !== 'private'
          ? [`今日${danger.tags.includes('chestPain') ? '胸痛' : '头晕'}：${tagText(danger)}`]
          : []),
      ],
      familyMessage: shareable
        ? urgent
          ? `【紧急】${context.today}：老人今日心率${dir === 'fast' ? '过快' : dir === 'slow' ? '过慢' : '快慢波动明显'}（${rangeText} bpm），请立即联系老人确认情况。`
          : `【请关注】${context.today}：老人今日心率${dir === 'fast' ? '持续偏快' : dir === 'slow' ? '持续偏慢' : '快慢波动明显'}（${rangeText} bpm），请帮助复测。`
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
    const extremes = todayMetricExtremes(context, 'bloodGlucose');
    if (!extremes) return null;
    const lowest = extremes.min;
    const highest = extremes.max;
    // 低血糖优先 (危险): 最低 < 3.5 紧急, < 3.9 alert; 高血糖: 最高 > 16.7 紧急, > 13.9 alert。
    // 低/高两个方向分别对照当日最低/最高读数，避免正常读数掩盖同日的低血糖危险值。
    const lowUrgent = lowest < 3.5;
    const lowAlert = lowest < 3.9;
    const highUrgent = highest > 16.7;
    const highAlert = highest > 13.9;
    if (!(lowAlert || highAlert)) return null;
    const urgent = lowUrgent || highUrgent;
    const shareable = familyEligibleMeasurements(context, 'bloodGlucose');
    const dir = lowAlert && highAlert ? 'both' : lowAlert ? 'low' : 'high';
    const rangeText =
      lowest === highest
        ? `${lowest}`
        : dir === 'both'
          ? `最低 ${lowest}、最高 ${highest}`
          : dir === 'low'
            ? `最低 ${lowest}`
            : `最高 ${highest}`;
    return addFinding(context.findings, {
      date: context.today,
      severity: urgent ? 'urgent' : 'alert',
      title: urgent
        ? dir === 'low'
          ? '血糖极低，需要立即处理'
          : dir === 'high'
            ? '血糖明显偏高，需要立即确认'
            : '血糖波动异常，需要立即处理'
        : dir === 'low'
          ? '血糖偏低，按低血糖路径处理'
          : dir === 'high'
            ? '血糖偏高，建议复测并联系医生'
            : '血糖波动异常，建议复测并记录',
      detail: urgent
        ? dir === 'low'
          ? '低血糖可快速进展为意识模糊。请立即按医生方案补糖，15 分钟内复测；如出现意识变化、抽搐，立即寻求急救。'
          : dir === 'high'
            ? '血糖明显偏高并伴口渴、乏力或意识变化时不要硬扛，立即联系医疗人员。'
            : '今天同时出现低血糖和明显偏高的读数。请先按医生方案处理低血糖，15 分钟内复测；如出现意识变化、抽搐，立即寻求急救，并尽快联系医生核对测量与用药。'
        : dir === 'low'
          ? '按低血糖路径补糖，15 分钟后再测一次，避免空腹剧烈活动；反复出现及时联系医生。'
          : dir === 'high'
            ? '复测一次确认测量时间和是否空腹；持续偏高或伴不舒服时及时联系医生。'
            : '今天同时记录到偏低和偏高的血糖。请规范复测并记下测量时间与是否空腹；波动持续或伴不舒服时及时联系医生。',
      evidence: [`今日血糖 ${rangeText} mmol/L`],
      familyMessage: shareable
        ? urgent
          ? `【紧急】${context.today}：老人今日血糖${dir === 'low' ? '过低' : dir === 'high' ? '明显偏高' : '同时过低和明显偏高'}（${rangeText} mmol/L），请立即联系老人按医生方案处理。`
          : `【请关注】${context.today}：老人今日血糖${dir === 'low' ? '偏低' : dir === 'high' ? '偏高' : '同时偏低和偏高'}（${rangeText} mmol/L），请帮助复测并按医生方案处理。`
        : undefined,
      carePath: urgent
        ? dir === 'both'
          ? '立即联系老人按医生方案处理并先排除低血糖；如出现意识变化、抽搐或严重不适，立即拨打当地急救电话。'
          : '立即联系老人按医生方案处理；如出现意识变化、抽搐或严重不适，立即拨打当地急救电话。'
        : dir === 'both'
          ? '规范复测并记录测量时间和是否空腹；持续波动或伴不舒服时及时联系医疗人员。'
          : '复测一次确认测量时间和是否空腹；持续异常或伴不舒服时及时联系医疗人员。',
      ruleId: 'safety.blood_glucose.extreme',
      score: urgent ? 5 : 4,
      signalKeys: ['bloodGlucose'],
      familyEligible: shareable,
    });
  },
};

/**
 * 发热安全分流（产品安全分流配置，不是诊断标准）。
 *
 * 判定顺序：
 * 1. 每条体温读数按**自己的测量部位**判级（阈值表集中在 temperatureBands.ts）。
 *    不同部位绝不先混在一起取最大值：耳温 37.9 与腋温 37.9 不是同一件事。
 * 2. 多条读数按严重度聚合；同级时取"超出本部位发热起点最多"的那条作为代表，
 *    并把它自己的部位写进证据和家属消息。
 * 3. 达到该部位发热起点并伴晕厥/神经变化/呼吸困难/胸痛 → 直接 urgent。
 * 4. 原文没说明部位时按 `unknown` 档评估（37.3 观察线，39.0/40.0 升级线），
 *    并在文案里明确要求补记部位；绝不把缺失部位默认成腋温。
 * 5. 私密体温读数或私密伴发症状一律不进入家属内容。
 */
interface TemperatureReading {
  value: number;
  site: TemperatureSite;
  band: TemperatureBand;
  grade: TemperatureGrade;
  private: boolean;
}

function todayTemperatureReadings(context: DetectionContext): TemperatureReading[] {
  return context.measurements
    .filter(
      (measurement: HealthMeasurement) =>
        measurement.metric === 'temperature' && measurement.timestamp.slice(0, 10) === context.today,
    )
    .map((measurement) => {
      const site = measurementTemperatureSite(measurement);
      const band = temperatureBand(site);
      return {
        value: measurement.value,
        site,
        band,
        grade: classifyTemperature(measurement.value, site),
        private: measurement.visibility === 'private',
      };
    });
}

export const temperatureSafetyRule: DetectionRule = {
  id: 'safety.temperature.fever',
  evaluate(context) {
    const readings = todayTemperatureReadings(context).filter((reading) => reading.grade !== 'normal');
    if (readings.length === 0) return null;
    const top = readings.reduce((best, current) => {
      const gradeOrder = compareTemperatureGrade(current.grade, best.grade);
      if (gradeOrder !== 0) return gradeOrder > 0 ? current : best;
      const currentExcess = current.value - current.band.watch;
      const bestExcess = best.value - best.band.watch;
      return currentExcess > bestExcess ? current : best;
    });

    const syncope = hadOccurredObservation(context.observations, 'syncope', context.today, 1);
    const neuroChange = hadOccurredObservation(context.observations, 'neuroChange', context.today, 1);
    const dyspnea = hadOccurredObservation(context.observations, 'dyspnea', context.today, 1);
    const chestPain = hadOccurredObservation(context.observations, 'chestPain', context.today, 1);
    const companion = syncope ?? neuroChange ?? dyspnea ?? chestPain;

    const urgent = top.grade === 'urgent' || companion !== null;
    const alert = top.grade === 'alert';
    const severity = urgent ? 'urgent' : alert ? 'alert' : 'watch';
    const hasPrivateTemperature = context.measurements.some(
      (measurement) =>
        measurement.metric === 'temperature' &&
        measurement.timestamp.slice(0, 10) === context.today &&
        measurement.visibility === 'private',
    );
    const shareable =
      familyEligibleMeasurements(context, 'temperature') &&
      !hasPrivateTemperature &&
      familyEligible(syncope, neuroChange, dyspnea, chestPain);

    const companionText = [
      syncope ? '晕厥/意识丧失' : '',
      neuroChange ? '突发神经系统异常' : '',
      dyspnea ? '呼吸困难/喘' : '',
      chestPain ? '胸痛' : '',
    ]
      .filter(Boolean)
      .join('、');
    const reading = `${top.value.toFixed(1)} ℃（${top.band.label}）`;
    // 未说明部位是一种必须被说出来的信息缺口，不能用"体温"两个字含混过去。
    const siteNote =
      top.site === 'unknown'
        ? '这次没有说明是腋温、口温还是耳温，先按未分部位的口径记录；请补记测量部位，并用同一部位复测。'
        : '';

    return addFinding(context.findings, {
      date: context.today,
      severity,
      title: urgent
        ? companion
          ? '体温升高并伴危险症状，需要立即确认'
          : '体温达到高热水平，需要立即确认'
        : alert
          ? '体温明显升高，今天需要联系医生'
          : '体温偏高，先记录并复测',
      detail: urgent
        ? companion
          ? `今天记录到的最高体温为 ${reading}，并伴${companionText}。先让老人休息、补充水分，不要自行加退烧药；立即联系医疗人员，症状明显时拨打当地急救电话。${siteNote}这不是诊断。`
          : `今天记录到的最高体温为 ${reading}。先让老人休息、补充水分，不要自行加退烧药；立即联系医疗人员，若出现意识不清、呼吸困难、抽搐或明显虚弱，立即拨打当地急救电话。${siteNote}这不是诊断。`
        : alert
          ? `今天记录到的最高体温为 ${reading}。先记录测量时间和测量方式，多喝水、注意休息；今天尽快联系医生确认处理，并观察有没有喘、胸痛、意识变化或明显虚弱。${siteNote}这不是诊断。`
          : `今天记录到的最高体温为 ${reading}。先记录测量时间，多喝水、注意休息，按设备说明复测一次；如果持续升高或伴喘、胸痛、意识变化，尽快联系医生。${siteNote}单次读数不能自行下诊断。`,
      evidence: [
        shareable ? `今日最高体温 ${reading}` : '今日有体温读数升高（具体读数未共享）。',
        ...(companion && shareable ? [`今日伴随症状：${companionText}`] : []),
      ],
      familyMessage:
        shareable && severity !== 'watch'
          ? severity === 'urgent'
            ? `【紧急】${context.today}：老人今日${top.band.label === '未分部位' ? '体温' : top.band.label}达到 ${top.value.toFixed(1)} ℃${companion ? `，并伴${companionText}` : ''}。请立即联系老人确认意识与呼吸，并按急救路径处理；症状明显时拨打当地急救电话。`
            : `【请关注】${context.today}：老人今日${top.band.label === '未分部位' ? '体温' : top.band.label}达到 ${top.value.toFixed(1)} ℃，请今天联系老人确认状态，并尽快联系医生。`
          : undefined,
      carePath:
        severity === 'urgent'
          ? '立即联系老人；让老人休息、补充水分，不要自行加退烧药；出现意识不清、呼吸困难、抽搐或明显虚弱时立即拨打当地急救电话。'
          : severity === 'alert'
            ? '今天联系老人复测体温并记录测量部位与时间；复测尽量用同一部位，持续升高或伴喘、胸痛、意识变化时尽快就医。'
            : '记录测量部位和时间，按设备说明用同一部位复测；持续升高或伴其他不适时联系医生。',
      ruleId: 'safety.temperature.fever',
      score: severity === 'urgent' ? 5 : severity === 'alert' ? 4 : 2,
      signalKeys: [
        'temperature',
        ...(syncope ? ['syncope'] : []),
        ...(neuroChange ? ['neuroChange'] : []),
        ...(dyspnea ? ['dyspnea'] : []),
        ...(chestPain ? ['chestPain'] : []),
      ],
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

/**
 * P0：晕厥/意识丧失。与跌倒分开成规则：两者可能同时发生，但“没有摔倒的晕厥”
 * 同样可能是心源性或神经源性急症，不能被 fall 规则漏掉。
 */
export const syncopeSafetyRule: DetectionRule = {
  id: 'safety.syncope',
  evaluate(context) {
    const syncope = hadOccurredObservation(context.observations, 'syncope', context.today, 1);
    if (!syncope) return null;
    const fall = hadOccurredObservation(context.observations, 'fall', context.today, 1);
    const chestPain = hadOccurredObservation(context.observations, 'chestPain', context.today, 1);
    const dyspnea = hadOccurredObservation(context.observations, 'dyspnea', context.today, 1);
    const shareable = familyEligible(syncope, fall, chestPain, dyspnea);
    const companions = [fall ? '跌倒' : '', chestPain ? '胸痛' : '', dyspnea ? '呼吸不适' : ''].filter(Boolean);
    return addFinding(context.findings, {
      date: context.today,
      severity: 'urgent',
      title: '出现晕厥/意识丧失，需要立即确认',
      detail:
        '先让老人平躺或侧卧，确认意识、呼吸和能否正常说话活动，不要急着站起来。如果还没完全清醒、反复晕厥，或伴胸痛、呼吸困难、说话/肢体异常，立即拨打当地急救电话。' +
        (companions.length > 0 ? `本次同时报告：${companions.join('、')}。` : ''),
      evidence: [shareable ? tagText(syncope) : '老人报告发生晕厥/意识丧失（具体聊天内容未共享）。'],
      familyMessage: shareable
        ? `【紧急】${context.today}：老人报告发生晕厥/意识丧失${companions.length > 0 ? `，并伴${companions.join('、')}` : ''}。请立即联系老人确认意识与呼吸，必要时拨打当地急救电话。`
        : undefined,
      carePath:
        '立即联系老人并确认意识、呼吸和跌倒受伤情况；未完全恢复、反复晕厥或伴胸痛/呼吸困难/神经系统异常时立即拨打当地急救电话。',
      ruleId: 'safety.syncope',
      score: 5,
      signalKeys: [
        'syncope',
        ...(fall ? ['fall'] : []),
        ...(chestPain ? ['chestPain'] : []),
        ...(dyspnea ? ['dyspnea'] : []),
      ],
      familyEligible: shareable,
    });
  },
};

/**
 * 黑便/便血：不直接下“消化道出血”的诊断，但在老年人和抗凝/止痛药背景下
 * 属于必须当天处理的信号。伴晕厥、头晕、心慌时升级为 urgent。
 */
export const melenaSafetyRule: DetectionRule = {
  id: 'safety.melena',
  evaluate(context) {
    const melena = hadOccurredObservation(context.observations, 'melena', context.today, 1);
    if (!melena) return null;
    const syncope = hadOccurredObservation(context.observations, 'syncope', context.today, 1);
    const dizziness = hadOccurredObservation(context.observations, 'dizziness', context.today, 1);
    const palpitations = hadOccurredObservation(context.observations, 'palpitations', context.today, 1);
    const danger = syncope ?? dizziness ?? palpitations;
    const urgent = danger !== null;
    const shareable = familyEligible(melena, syncope, dizziness, palpitations);
    return addFinding(context.findings, {
      date: context.today,
      severity: urgent ? 'urgent' : 'alert',
      title: urgent ? '黑便/便血并伴不适，需要立即就医' : '出现黑便/便血，需要尽快联系医生',
      detail: urgent
        ? '黑便或便血同时伴晕厥、头晕或心慌，可能提示失血或循环不稳定。不要自行吃止痛药或止血药，立即联系医疗人员；症状明显时拨打当地急救电话。这不是诊断。'
        : '黑便或便血不能只当成“上火”或饮食颜色。先记录颜色、次数和正在服用的药物，尽快联系医生；如果出现头晕、心慌、乏力、晕倒或持续加重，立即就医。',
      evidence: [shareable ? tagText(melena) : '老人报告黑便/便血（具体聊天内容未共享）。'],
      familyMessage: shareable
        ? urgent
          ? `【紧急】${context.today}：老人报告黑便/便血，并伴头晕、心慌或晕厥。请立即联系老人并尽快就医；症状明显时拨打当地急救电话。`
          : `【请关注】${context.today}：老人报告黑便/便血。请今天联系老人确认情况，并尽快联系医生；如出现头晕、心慌或晕倒，立即就医。`
        : undefined,
      carePath: urgent
        ? '立即联系老人并尽快就医；出现晕厥、明显头晕、心慌、持续乏力或黑便增多时拨打当地急救电话。'
        : '今天联系医生，记录黑便次数、颜色和正在服用的药物；出现头晕、心慌、晕倒或加重时立即就医。',
      ruleId: 'safety.melena',
      score: urgent ? 5 : 4,
      signalKeys: ['melena', ...(danger ? danger.tags : [])],
      familyEligible: shareable,
    });
  },
};
