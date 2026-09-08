import type { CareTask, DayRecord, FamilySharing } from '../types';
import type { FamilyNotification } from '../engine/escalate';
import { severityBadge } from '../engine/escalate';

export default function FamilyDashboard({
  notifications,
  tasks,
  sharing,
  records,
  observationCount = 0,
  hasUnsharedRecords = false,
  onTaskStatus,
  onReport,
}: {
  notifications: FamilyNotification[];
  tasks: CareTask[];
  sharing: FamilySharing;
  records: DayRecord[];
  observationCount?: number;
  hasUnsharedRecords?: boolean;
  onTaskStatus: (id: string, status: CareTask['status']) => void;
  onReport: () => void;
}) {
  const urgent = notifications.some((n) => n.finding.severity === 'urgent');
  const title = urgent
    ? '有一件事需要立即确认'
    : notifications.length
      ? '有变化值得您关注'
      : sharing !== 'granted' && observationCount === 0 && records.length === 0
        ? '等待老人授权共享'
        : records.length === 0 && observationCount === 0
          ? hasUnsharedRecords
            ? '已有记录，但尚未授权这些记录'
            : '尚未收到健康记录'
          : '目前暂无需要介入的通知';
  const active = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress');
  return (
    <div className="family-dashboard">
      <section className="card family-status">
        <div className="eyebrow">家属概况</div>
        <h1>{title}</h1>
        <p>只整理已获授权的信息。没有通知，不代表已经确认健康正常。</p>
        <button className="btn-secondary" onClick={onReport}>
          查看健康报告
        </button>
      </section>
      {notifications.length > 0 && (
        <section className="card">
          <h2>需要关注的变化</h2>
          {notifications.map((n) => (
            <article className="finding" key={n.finding.id}>
              <span className={`badge ${severityBadge(n.finding.severity).className}`}>
                {severityBadge(n.finding.severity).text}
              </span>
              <h3>{n.finding.title}</h3>
              <p>{n.message}</p>
              <p className="muted">为什么提醒：{n.reason}</p>
              <p>{n.actionPath}</p>
            </article>
          ))}
        </section>
      )}
      <section className="card">
        <h2>我能帮忙做什么？</h2>
        {active.length ? (
          active.map((task) => (
            <div className="family-task" key={task.id}>
              <div>
                <strong>{task.title}</strong>
                <p>{task.description}</p>
              </div>
              <button className="btn-primary" onClick={() => onTaskStatus(task.id, 'completed')}>
                标记已处理
              </button>
            </div>
          ))
        ) : (
          <p className="muted">暂无已授权的待处理事项。</p>
        )}
        <p className="muted">这里只记录处理状态，不会自动判定问题已改善。</p>
      </section>
    </div>
  );
}
