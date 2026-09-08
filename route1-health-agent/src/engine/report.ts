/** 每周健康周报 —— 把一周的数据与此前稳定窗口分开比较。 */
import type { CareTask, DayRecord, Finding, Observation } from '../types';
import { METRICS, type MetricKey } from '../types';
import { computeBaseline, recentMean, diffDays } from './baseline';
import { localDate } from './date';

export interface ReportSection {
  title: string;
  lines: string[];
}
export interface WeeklyReport {
  rangeText: string;
  sections: ReportSection[];
  forElder: string;
  forFamily: string;
}

const REPORT_METRICS: MetricKey[] = [
  'systolic',
  'diastolic',
  'bloodGlucose',
  'steps',
  'sleepHours',
  'nightWakes',
  'restingHr',
  'weight',
];

function previousDay(date: string): string {
  return new Date(Date.parse(date) - 86400000).toISOString().slice(0, 10);
}

/** 生成以 weekEnd 结尾、跨度 7 天的周报；基线严格使用本周开始之前的数据。 */
export function buildWeeklyReport(
  records: DayRecord[],
  observations: Observation[],
  findings: Finding[],
  weekEnd: string,
  tasks: CareTask[] = [],
  audience: 'elder' | 'family' = 'family',
): WeeklyReport {
  const weekStart = new Date(Date.parse(weekEnd) - 6 * 86400000).toISOString().slice(0, 10);
  const baselineEnd = previousDay(weekStart);
  const inWeek = (date: string) => diffDays(date, weekEnd) >= 0 && diffDays(date, weekEnd) < 7;
  const sections: ReportSection[] = [];
  tasks = tasks.filter((task) => {
    if (task.status === 'completed') return Boolean(task.completedAt && inWeek(localDate(new Date(task.completedAt))));
    if (task.status === 'dismissed') return Boolean(task.updatedAt && inWeek(localDate(new Date(task.updatedAt))));
    return task.createdAt.slice(0, 10) <= weekEnd;
  });
  let comparable = false;

  const metricLines: string[] = [];
  for (const key of REPORT_METRICS) {
    const meta = METRICS[key];
    const base = computeBaseline(records, key, { endDate: baselineEnd, excludeDays: 0, windowDays: 21 });
    const weekAvg = recentMean(records, key, weekEnd, 7);
    if (weekAvg === null) continue;
    if (!base) {
      metricLines.push(
        `${meta.label}：本周平均 ${weekAvg.toFixed(meta.decimals)} ${meta.unit}（此前数据不足，暂无个人基线可比）`,
      );
      continue;
    }
    comparable = true;
    const delta = weekAvg - base.mean;
    const pctText =
      base.mean !== 0
        ? `（较此前个人平时${delta > 0 ? '高' : '低'} ${Math.abs(Math.round((delta / base.mean) * 100))}%）`
        : '';
    const badDelta = meta.higherIsBad ? delta : -delta;
    const note = badDelta > 0 && Math.abs(delta / Math.max(base.sd, 1e-9)) >= 1 ? ' ← 变化比较明显' : '';
    metricLines.push(
      `${meta.label}：本周平均 ${weekAvg.toFixed(meta.decimals)} ${meta.unit}，此前平时约 ${base.mean.toFixed(meta.decimals)} ${meta.unit}${pctText}${note}`,
    );
  }
  sections.push({
    title: '身体数据这一周',
    lines: metricLines.length ? metricLines : ['这一周暂无足够的结构化指标数据。'],
  });

  const weekObs = observations.filter((o) => inWeek(o.date) && (audience === 'elder' || o.visibility !== 'private'));
  sections.push({
    title: '您自己说过的',
    lines: weekObs.length ? weekObs.map((o) => `${o.date}：${o.text}`) : ['这一周暂无主观状态记录。'],
  });

  const weekFindings = findings.filter(
    (f) => inWeek(f.date) && (f.severity === 'alert' || f.severity === 'watch' || f.severity === 'urgent'),
  );
  sections.push({
    title: '需要留意的变化',
    lines: weekFindings.length
      ? weekFindings.map((f) => `【${f.title}】${f.evidence[0]}`)
      : [comparable ? '已有记录中暂无需要特别留意的变化。' : '暂无足够记录判断近期趋势。'],
  });

  if (tasks.length > 0) {
    const completed = tasks.filter((task) => task.status === 'completed').length;
    const pending = tasks.filter((task) => task.status === 'pending' || task.status === 'in_progress').length;
    const dismissed = tasks.filter((task) => task.status === 'dismissed').length;
    sections.push({
      title: '本周处理与当前待办',
      lines: [
        `已完成 ${completed} 项，待处理 ${pending} 项，已忽略 ${dismissed} 项。`,
        ...tasks.map(
          (task) =>
            `${task.status === 'completed' ? '已完成' : task.status === 'dismissed' ? '已忽略' : '待处理'}：${task.title}`,
        ),
      ],
    });
  }

  const hasAlert = findings.some((f) => inWeek(f.date) && (f.severity === 'alert' || f.severity === 'urgent'));
  const completedCount = tasks.filter((task) => task.status === 'completed').length;
  const pendingCount = tasks.filter((task) => task.status === 'pending' || task.status === 'in_progress').length;
  return {
    rangeText: `${weekStart} ~ ${weekEnd}`,
    sections,
    forElder: hasAlert
      ? '这周您的身体状态比此前个人平时有一些变化，我在帮您盯着。您按自己的医生建议用药和活动，别太累。'
      : !comparable
        ? '暂无足够记录判断健康趋势。您可以在助手里说说近期情况，逐步积累自己的记录。'
        : '已有记录中暂未发现需要特别留意的变化。',
    forFamily:
      `${weekStart} ~ ${weekEnd} 周报：` +
      (hasAlert
        ? `本周检测到持续偏离此前个人基线的变化（详见“需要留意的变化”），建议近期多联系老人，必要时陪同就医。${completedCount || pendingCount ? ` 已完成 ${completedCount} 项照护任务，仍有 ${pendingCount} 项待处理。` : ''}`
        : `${comparable ? '已有共享记录中暂未发现需要特别留意的变化。' : '暂无足够的共享记录判断健康趋势。'}${completedCount || pendingCount ? ` 本周已完成 ${completedCount} 项照护任务，仍有 ${pendingCount} 项待处理。` : ''}`),
  };
}
