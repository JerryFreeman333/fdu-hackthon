/**
 * 变化检测引擎 —— 从"数据 + 主诉"里发现"和平时不一样"。
 * 原则：不做疾病诊断，只做状态变化发现，输出证据链。
 */
import type { DayRecord, Finding, Observation, SymptomTag } from '../types';
import { METRICS } from '../types';
import { computeBaseline, recentMean, diffDays } from './baseline';

let seq = 0;
function makeId(prefix: string, date: string): string {
  seq += 1;
  return `${prefix}-${date}-${seq}`;
}

function fmt(metricKey: keyof typeof METRICS, value: number): string {
  const meta = METRICS[metricKey];
  return `${value.toFixed(meta.decimals)} ${meta.unit}`;
}

/** 最近几天内是否出现过某类主诉 */
function hadTag(observations: Observation[], tag: SymptomTag, endDate: string, days: number): Observation | null {
  return (
    observations.find(
      (o) => o.tags.includes(tag) && diffDays(o.date, endDate) >= 0 && diffDays(o.date, endDate) < days,
    ) ?? null
  );
}

/**
 * 主检测入口。
 * @param records    每日指标记录（设备 + 拍照录入）
 * @param observations 主诉/观察（聊天识别、拍照识别）
 * @param today      检测基准日 YYYY-MM-DD
 */
export function runDetection(
  records: DayRecord[],
  observations: Observation[],
  today: string,
): Finding[] {
  const findings: Finding[] = [];
  const recentDays = 3;

  // ---------- 单指标持续偏离 ----------
  const perMetricChecks: Array<{
    key: keyof typeof METRICS;
    /** 触发条件：recent3 相对基线的变化比例（按变差方向取正） */
    thresholdRatio: number;
    title: string;
    detail: string;
    severity: 'watch' | 'alert';
  }> = [
    {
      key: 'steps',
      thresholdRatio: 0.3,
      title: '活动量持续低于个人基线',
      detail: '最近几天您走得比平时少了不少，不用勉强，但可以试着每天在屋里多走动几分钟。',
      severity: 'watch',
    },
    {
      key: 'walkSpeed',
      thresholdRatio: 0.15,
      title: '步速比平时变慢',
      detail: '您最近走路比平时慢了，留意一下脚下，起身、转身时慢一点。',
      severity: 'watch',
    },
    {
      key: 'restingHr',
      thresholdRatio: 0.08,
      title: '静息心率比平时偏高',
      detail: '您安静时的心跳比平时快了一些，先休息好，我会继续盯着看。',
      severity: 'watch',
    },
    {
      key: 'spo2',
      thresholdRatio: 0.02,
      title: '血氧比平时偏低',
      detail: '您的血氧比平时低了一点，开窗透透气再测一次看看。',
      severity: 'watch',
    },
  ];

  for (const check of perMetricChecks) {
    const meta = METRICS[check.key];
    const base = computeBaseline(records, check.key, { endDate: today, excludeDays: recentDays });
    const rec = recentMean(records, check.key, today, recentDays);
    if (!base || rec === null) continue;

    const bad = meta.higherIsBad ? rec - base.mean : base.mean - rec;
    const ratio = bad / base.mean; // 变差方向上的相对变化（正 = 变差）
    if (ratio < check.thresholdRatio) continue;

    const dir = meta.higherIsBad ? '升高' : '下降';
    findings.push({
      id: makeId('metric', today),
      date: today,
      severity: check.severity,
      title: check.title,
      detail: check.detail,
      evidence: [
        `最近${recentDays}天${meta.label}平均 ${fmt(check.key, rec)}，个人基线 ${fmt(check.key, base.mean)}（${dir}约 ${Math.abs(Math.round(ratio * 100))}%）`,
        `基线窗口：最近 ${base.n} 天`,
      ],
    });
  }

  // ---------- 夜间频繁醒来 ----------
  const wakes = recentMean(records, 'nightWakes', today, recentDays);
  if (wakes !== null && wakes >= 2.5) {
    findings.push({
      id: makeId('sleep', today),
      date: today,
      severity: 'watch',
      title: '夜间醒来次数变多',
      detail: '您最近起夜的次数比平时多，睡前少喝水、地上留个小夜灯，小心别摔倒。',
      evidence: [`最近${recentDays}天平均每夜醒来 ${wakes.toFixed(1)} 次`],
    });
  }

  // ---------- 短期体重快速上升（需警惕的客观信号） ----------
  const weightBase = computeBaseline(records, 'weight', { endDate: today, excludeDays: recentDays });
  const weightRecent = recentMean(records, 'weight', today, recentDays);
  if (weightBase && weightRecent !== null && weightRecent - weightBase.mean >= 1.2) {
    const gain = (weightRecent - weightBase.mean).toFixed(1);
    findings.push({
      id: makeId('weight', today),
      date: today,
      severity: 'alert',
      title: '几天内体重快速上升',
      detail:
        '您这几天体重涨得比较快，这种"短时间涨秤"不一定是长胖，先少盐清淡饮食，我会建议家里人关注一下。',
      evidence: [
        `最近${recentDays}天平均体重比基线高 ${gain} kg`,
        `基线体重约 ${fmt('weight', weightBase.mean)}`,
      ],
    });
  }

  // ---------- 融合规则：活动耐量下降风险（心衰场景的核心） ----------
  const fatigueObs = hadTag(observations, 'fatigue', today, recentDays);
  const dyspneaObs = hadTag(observations, 'dyspnea', today, recentDays);
  const edemaObs = hadTag(observations, 'edema', today, recentDays);
  const poorSleepObs = hadTag(observations, 'poorSleep', today, recentDays);

  const stepsBase = computeBaseline(records, 'steps', { endDate: today, excludeDays: recentDays });
  const stepsRec = recentMean(records, 'steps', today, recentDays);
  const speedBase = computeBaseline(records, 'walkSpeed', { endDate: today, excludeDays: recentDays });
  const speedRec = recentMean(records, 'walkSpeed', today, recentDays);
  const hrBase = computeBaseline(records, 'restingHr', { endDate: today, excludeDays: recentDays });
  const hrRec = recentMean(records, 'restingHr', today, recentDays);

  if (stepsBase && stepsRec !== null) {
    const stepsDrop = (stepsBase.mean - stepsRec) / stepsBase.mean; // 正 = 活动量下降
    const speedDrop = speedBase && speedRec !== null ? (speedBase.mean - speedRec) / speedBase.mean : 0;
    const hrRise = hrBase && hrRec !== null ? hrRec - hrBase.mean : 0;

    const groupA = stepsDrop >= 0.3; // 活动量明显下降
    const groupB = speedDrop >= 0.12 || fatigueObs !== null || dyspneaObs !== null; // 行动能力/主观乏力
    const groupC =
      hrRise >= 5 || edemaObs !== null || (weightBase && weightRecent !== null
        ? weightRecent - weightBase.mean >= 1.0
        : false) || (wakes !== null && wakes >= 2.5); // 容量/心脏相关信号

    if (groupA && groupB && groupC) {
      const evidence: string[] = [
        `步数：最近${recentDays}天平均 ${Math.round(stepsRec)} 步/天，比个人基线低约 ${Math.round(stepsDrop * 100)}%`,
      ];
      if (speedBase && speedRec !== null && speedDrop >= 0.12) {
        evidence.push(`步速：平均 ${speedRec.toFixed(2)} m/s，比基线慢约 ${Math.round(speedDrop * 100)}%`);
      }
      if (fatigueObs) evidence.push(`主诉：${fatigueObs.date} 说"${fatigueObs.text}"`);
      if (dyspneaObs) evidence.push(`主诉：${dyspneaObs.date} 说"${dyspneaObs.text}"`);
      if (poorSleepObs) evidence.push(`主诉：${poorSleepObs.date} 说"${poorSleepObs.text}"`);
      if (edemaObs) evidence.push(`主诉：${edemaObs.date} 说"${edemaObs.text}"`);
      if (hrBase && hrRec !== null && hrRise >= 5) {
        evidence.push(`静息心率：平均 ${Math.round(hrRec)} bpm，比基线高约 ${Math.round(hrRise)} bpm`);
      }
      if (weightBase && weightRecent !== null && weightRecent - weightBase.mean >= 1.0) {
        evidence.push(`体重：比基线高 ${(weightRecent - weightBase.mean).toFixed(1)} kg`);
      }
      if (wakes !== null && wakes >= 2.5) evidence.push(`夜间醒来：平均每夜 ${wakes.toFixed(1)} 次`);

      const urgent = edemaObs !== null && weightBase !== null && weightRecent !== null && weightRecent - weightBase.mean >= 1.2;
      findings.push({
        id: makeId('fusion', today),
        date: today,
        severity: urgent ? 'urgent' : 'alert',
        title: '活动耐量可能正在下降，建议关注',
        detail:
          '把您最近说的话和手表、体重的数据放在一起看，您的活动能力和状态这几天变化比较明显。这不是诊断，但这种"和平时不一样"值得认真对待。先别太劳累，如果气喘加重、半夜躺不平，尽快联系医生。',
        evidence,
        familyMessage: urgent
          ? `【请尽快关注】${today}：结合连续数据与老人主诉（活动量骤降、气喘、水肿、体重快速上升），疑似活动耐量明显下降，建议今天联系老人并考虑陪同就医。`
          : `【建议关注】${today}：最近${recentDays}天活动量持续下降约 ${Math.round(stepsDrop * 100)}%，并伴随疲劳/气喘等主诉，建议今晚联系一下老人，问问身体情况。`,
        carePath: urgent
          ? '1）今天联系老人或同住家属确认状态；2）联系社区医生问诊；3）如气喘加重、夜间不能平卧，前往医院心内科急诊。'
          : undefined,
      });
    }
  }

  // ---------- 主诉轻提醒（不打扰家属） ----------
  if (fatigueObs && !findings.some((f) => f.id.startsWith('fusion'))) {
    findings.push({
      id: makeId('chat-fatigue', today),
      date: today,
      severity: 'info',
      title: '提到疲惫',
      detail: '您说最近比较累，先休息好。如果这种累持续好几天，或者一活动就喘，随时告诉我。',
      evidence: [`${fatigueObs.date} 说"${fatigueObs.text}"`],
    });
  }

  // ---------- 跌倒 = 最高优先级 ----------
  const fallObs = hadTag(observations, 'fall', today, 1);
  if (fallObs) {
    findings.push({
      id: makeId('fall', today),
      date: today,
      severity: 'urgent',
      title: '发生跌倒，需要立即关注',
      detail: '跌倒后就算感觉还好，也要确认一下有没有受伤。先别急着起身，慢慢动。',
      evidence: [`${fallObs.date} 说"${fallObs.text}"`],
      familyMessage: `【紧急】${today}：老人报告跌倒，请立即联系老人确认情况。`,
      carePath: '1）立即电话联系老人；2）确认受伤情况；3）必要时拨打 120 或前往医院。',
    });
  }

  // ---------- 排序：越严重越靠前 ----------
  const order = { urgent: 0, alert: 1, watch: 2, info: 3 } as const;
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** 汇总今天的主诉标签（给界面显示用） */
export function todayTags(observations: Observation[], today: string): SymptomTag[] {
  return observations
    .filter((o) => o.date === today)
    .flatMap((o) => o.tags)
    .filter((tag, i, arr) => arr.indexOf(tag) === i);
}
