import type { DayRecord, Finding, Observation } from '../types';
import { buildWeeklyReport } from '../engine/report';

interface ReportViewProps {
  records: DayRecord[];
  observations: Observation[];
  findings: Finding[];
  today: string;
}

export default function ReportView({ records, observations, findings, today }: ReportViewProps) {
  const report = buildWeeklyReport(records, observations, findings, today);

  return (
    <div className="report-view">
      <div className="card">
        <div className="report-head">
          <h3>每周变化小结</h3>
          <span className="muted">{report.rangeText} · 当前为本地 Demo 即时生成</span>
        </div>
        <p className="report-summary">{report.forElder}</p>
      </div>

      {report.sections.map((sec) => (
        <div key={sec.title} className="card">
          <h3>{sec.title}</h3>
          <ul className="report-lines">
            {sec.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      ))}

      <div className="card family-card">
        <h3>给家属的版本</h3>
        <p>{report.forFamily}</p>
        <p className="muted">当前 Demo 只负责生成内容，不执行真实的定时发送或消息推送；后续可在不改变 Report Engine 的前提下接入通知服务。</p>
      </div>
    </div>
  );
}
