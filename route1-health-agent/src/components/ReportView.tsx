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
          <h3>每周健康周报</h3>
          <span className="muted">{report.rangeText}</span>
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
        <h3>给子女的版本</h3>
        <p>{report.forFamily}</p>
        <p className="muted">周报默认每周日发给老人一份、子女一份；有 alert 级变化时会提前单独通知，不用等到周末。</p>
      </div>
    </div>
  );
}
