import type { Finding } from '../types';
import type { FamilyNotification } from '../engine/escalate';
import { severityBadge } from '../engine/escalate';

interface FamilyViewProps {
  notifications: FamilyNotification[];
  findings: Finding[];
}

export default function FamilyView({ notifications, findings }: FamilyViewProps) {
  const quiet = findings.filter((f) => f.severity === 'watch' || f.severity === 'info');

  return (
    <div className="family-view">
      <div className="card">
        <h3>通知原则</h3>
        <p className="muted">
          平时不打扰：<b>小提示 / 持续观察</b> 级别的变化只留在老人的应用里；
          只有<b>建议关注 / 紧急</b>级别才通知家属，并且附上具体证据和该做什么。
        </p>
      </div>

      <h3 className="section-title">已推送给家属（{notifications.length} 条）</h3>
      {notifications.length === 0 && <div className="card muted">当前没有需要打扰家属的情况。</div>}
      {notifications.map((n) => {
        const badge = severityBadge(n.finding.severity);
        return (
          <div key={n.finding.id} className={`card notif-card ${n.finding.severity === 'urgent' ? 'notif-urgent' : ''}`}>
            <div className="finding-head">
              <span className={`badge ${badge.className}`}>{badge.text}</span>
              <b>{n.finding.title}</b>
              <span className="muted right">{n.finding.date}</span>
            </div>
            <div className="notif-message">{n.message}</div>
            <ul className="evidence">
              {n.finding.evidence.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
            {n.actionPath && (
              <div className="care-path">
                <b>建议处理路径：</b>
                <p>{n.actionPath}</p>
              </div>
            )}
            <div className="notif-actions">
              <button className="btn-primary">📞 联系老人</button>
              <button className="btn-secondary">查看完整档案</button>
            </div>
          </div>
        );
      })}

      <h3 className="section-title">暂不打扰家属的观察（{quiet.length} 条）</h3>
      {quiet.map((f) => {
        const badge = severityBadge(f.severity);
        return (
          <div key={f.id} className="card quiet-card">
            <div className="finding-head">
              <span className={`badge ${badge.className}`}>{badge.text}</span>
              <b>{f.title}</b>
            </div>
            <p className="muted">{f.detail}</p>
          </div>
        );
      })}
    </div>
  );
}
