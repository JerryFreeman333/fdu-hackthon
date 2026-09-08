import { useState } from 'react';
import { demoImageHealthParser, type DemoImageKind } from '../adapters/DemoImageHealthParser';
import type { CareTask, DayRecord, Finding, Observation } from '../types';
import { buildWeeklyReport } from '../engine/report';
import ProfileView from './ProfileView';

interface ReportViewProps {
  records: DayRecord[];
  observations: Observation[];
  findings: Finding[];
  tasks?: CareTask[];
  today: string;
  audience?: 'elder' | 'family';
  demo?: boolean;
  canShare?: boolean;
  visibleObservationIds?: string[];
  onShareObservation?: (id: string) => void;
}
export default function ReportView({
  records,
  observations,
  findings,
  tasks = [],
  today,
  audience = 'elder',
  demo = false,
  canShare = false,
  visibleObservationIds = [],
  onShareObservation,
}: ReportViewProps) {
  const report = buildWeeklyReport(records, observations, findings, today, tasks, audience);
  const priority = ['需要留意的变化', '本周处理与当前待办'];
  const sections = [...report.sections].sort(
    (a, b) => (priority.includes(a.title) ? 0 : 1) - (priority.includes(b.title) ? 0 : 1),
  );
  return (
    <div className="report-view">
      <section className="card report-overview">
        <div className="eyebrow">
          {demo ? '演示样例 · 不代表本人健康状态' : audience === 'elder' ? '我的健康报告' : '已授权健康报告'}
        </div>
        <h1>这一周，有什么变化？</h1>
        <p className="muted">{report.rangeText} · 根据现有记录即时整理</p>
        <p className="report-summary">{audience === 'elder' ? report.forElder : report.forFamily}</p>
        <p className="muted">
          {demo
            ? '以下为预设样例，不会写入个人档案或家属待办。'
            : '当前来源：本人对话记录；基本档案为本人填写。尚未接入真实设备与照片识别。'}
        </p>
      </section>
      {!demo && audience === 'elder' && (
        <section className="card">
          <h2>已保存的健康记录与共享状态</h2>
          {observations.length === 0 && <p>还没有健康记录。</p>}
          {observations.map((observation) => (
            <article key={observation.id}>
              <p>
                {observation.date}：{observation.text}
              </p>
              <p>
                {visibleObservationIds.includes(observation.id)
                  ? '已保存 · 家属可查看（不代表已读）'
                  : '已保存 · 仅自己可见'}
              </p>
              {!visibleObservationIds.includes(observation.id) && onShareObservation && (
                <button
                  className="btn-secondary"
                  disabled={!canShare}
                  onClick={() => onShareObservation(observation.id)}
                >
                  只共享这条记录
                </button>
              )}
            </article>
          ))}
          {!canShare && <p>如需共享，请先在“我的”中绑定家属。只共享一条不会开启长期共享。</p>}
        </section>
      )}
      {findings.some((f) => f.carePath) && (
        <section className="card">
          <h2>接下来可以做什么</h2>
          <ul className="report-lines">
            {findings
              .filter((f) => f.carePath)
              .map((f) => (
                <li key={f.id}>{f.carePath}</li>
              ))}
          </ul>
        </section>
      )}
      {sections.map((section) =>
        priority.includes(section.title) ? (
          <section className="card" key={section.title}>
            <h2>{section.title}</h2>
            <ul className="report-lines">
              {section.lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </section>
        ) : (
          <details className="card" key={section.title}>
            <summary>
              {audience === 'family' && section.title === '您自己说过的' ? '老人主动记录的情况' : section.title}
            </summary>
            <ul className="report-lines">
              {section.lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </details>
        ),
      )}
      {(records.length > 0 || observations.length > 0) && (
        <details className="card">
          <summary>查看详细记录与指标趋势</summary>
          <ProfileView records={records} observations={observations} findings={findings} today={today} />
        </details>
      )}
      <p className="muted">任务“已完成”表示有人确认处理，不代表健康改善已验证。报告用于记录变化，不作疾病诊断。</p>
    </div>
  );
}

export function PhotoDemo() {
  const [kind, setKind] = useState<DemoImageKind>('bloodPressure');
  const [result, setResult] = useState('');
  const [pending, setPending] = useState(false);
  async function preview(file: File) {
    setPending(true);
    setResult('');
    try {
      const parsed = await demoImageHealthParser.parse(file, {
        userId: 'demo-preview',
        capturedAt: new Date().toISOString(),
        kind,
      });
      setResult(parsed.rawText ?? '已生成演示样例');
    } catch {
      setResult('本次演示未完成，请重新选择。');
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="settings-card">
      <p>这里展示旧版拍照录入流程。不会读取照片内容，也不会写入您的健康记录；选择照片后只返回预设示例。</p>
      <label>
        演示类型
        <select
          value={kind}
          disabled={pending}
          onChange={(e) => {
            setKind(e.target.value as DemoImageKind);
            setResult('');
          }}
        >
          <option value="bloodPressure">血压计</option>
          <option value="weight">体重秤</option>
          <option value="report">体检报告</option>
        </select>
      </label>
      <label>
        选择照片预览示例
        <input
          type="file"
          accept="image/*"
          disabled={pending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void preview(file);
            e.target.value = '';
          }}
        />
      </label>
      <p role="status">{pending ? '正在生成演示样例…' : result}</p>
    </div>
  );
}
