import type { CareTask, DayRecord, ElderProfile, FamilyLink, Finding, Observation } from '../types';
import type { FamilyNotification } from '../engine/escalate';
import { severityBadge } from '../engine/escalate';
import ProfileView from './ProfileView';
import ReportView from './ReportView';

interface FamilyDashboardProps {
  profile: ElderProfile;
  familyLink: FamilyLink;
  notifications: FamilyNotification[];
  findings: Finding[];
  tasks: CareTask[];
  records: DayRecord[];
  observations: Observation[];
  today: string;
  onTaskStatus: (taskId: string, status: CareTask['status']) => void;
  onContactElder: () => void;
  onRevokeSharing: () => void;
  onViewChange: (view: 'home' | 'detail' | 'report') => void;
  view: 'home' | 'detail' | 'report';
}

function overallMessage(notifications: FamilyNotification[]): { title: string; detail: string; tone: string } {
  if (notifications.some((notification) => notification.finding.severity === 'urgent')) return { title: '今天需要立即介入', detail: '出现需要马上确认安全情况的信号。请先联系老人并按提示的安全路径处理。', tone: 'danger' };
  if (notifications.some((notification) => notification.finding.severity === 'alert')) return { title: '今天有一件事值得关注', detail: '系统把多项近期变化放在一起看后，建议今天主动联系老人确认状态。', tone: 'warn' };
  return { title: '今天总体正常', detail: '暂时没有需要家属介入的明显变化。系统会继续观察，发生变化再提醒您。', tone: 'ok' };
}

export default function FamilyDashboard(props: FamilyDashboardProps) {
  const state = overallMessage(props.notifications);
  const familyFindings = props.findings.filter((finding) => finding.familyEligible !== false);
  const familyObservations = props.observations.filter((observation) => observation.visibility !== 'private');
  const canViewSharedDetail = props.profile.familySharing === 'granted';

  if (props.view === 'detail') {
    if (!canViewSharedDetail) return <div className="card privacy-card"><h3>当前未共享详细健康资料</h3><p>老人尚未授权家属查看详细健康资料。需要了解情况，请直接联系老人。</p><button className="btn-primary" onClick={props.onContactElder}>联系老人</button></div>;
    return <div className="family-detail"><div className="family-back"><button className="btn-secondary" onClick={() => props.onViewChange('home')}>← 返回</button><button className="btn-secondary" onClick={() => props.onViewChange('report')}>查看周报</button></div><ProfileView records={props.records} observations={familyObservations} findings={familyFindings} today={props.today} /></div>;
  }
  if (props.view === 'report') {
    if (!canViewSharedDetail) return <div className="card privacy-card"><h3>当前未共享周报</h3><p>老人尚未授权家属查看周报。需要了解情况，请直接联系老人。</p><button className="btn-primary" onClick={props.onContactElder}>联系老人</button></div>;
    return <div className="family-detail"><div className="family-back"><button className="btn-secondary" onClick={() => props.onViewChange('home')}>← 返回</button></div><ReportView records={props.records} observations={familyObservations} findings={familyFindings} today={props.today} /></div>;
  }

  const activeTasks = props.tasks.filter((task) => task.status !== 'completed' && task.status !== 'dismissed').slice(0, 3);
  return <div className="family-dashboard">
    <section className={`family-status card status-${state.tone}`}>
      <div className="eyebrow">{props.profile.name} · 家属端</div>
      <h2>{state.title}</h2>
      <p>{state.detail}</p>
      <div className="family-actions"><button className="btn-primary" onClick={props.onContactElder}>📞 联系老人</button><button className="btn-secondary" onClick={() => props.onViewChange('detail')}>查看详细变化</button></div>
    </section>

    <section className="card">
      <div className="section-head"><div><h3>现在最需要知道的</h3><span className="muted">不是监控所有指标，只看是否需要您介入。</span></div></div>
      {props.notifications.length === 0 ? <p className="family-empty">目前没有新的家属通知。系统会在真正需要时提醒您。</p> : <div className="family-feed">{props.notifications.slice(0, 3).map((notification) => { const badge = severityBadge(notification.finding.severity); return <div key={notification.finding.id} className={`family-item family-item-${notification.finding.severity}`}><div className="finding-head"><span className={`badge ${badge.className}`}>{badge.text}</span><b>{notification.finding.title}</b><span className="muted right">{notification.finding.date}</span></div><p>{notification.message}</p><span className="muted">为什么现在告诉您：{notification.reason}</span>{notification.actionPath && <div className="care-path"><b>建议行动：</b>{notification.actionPath}</div>}</div>; })}</div>}
    </section>

    <section className="card">
      <div className="section-head"><div><h3>帮老人把事情做完</h3><span className="muted">提醒不是终点，处理完成才算闭环。</span></div></div>
      {activeTasks.length === 0 ? <p className="family-empty">今天的事情都完成了。</p> : activeTasks.map((task) => <div className="family-task" key={task.id}><div><strong>{task.title}</strong><p>{task.description}</p></div><button className="btn-secondary" onClick={() => props.onTaskStatus(task.id, 'completed')}>标记已完成</button></div>)}
    </section>

    <section className="card privacy-card"><div><h3>家庭共享</h3><p className="muted">当前绑定：{props.familyLink.relation} · {props.familyLink.displayName} · {props.familyLink.maskedContact}</p><p className="muted">邀请码：{props.familyLink.inviteCode}</p><p className="muted">老人当前授权：{props.profile.familySharing === 'granted' ? '已同意在必要时共享' : props.profile.familySharing === 'ask' ? '每次需要先征得同意' : '暂不共享'}</p></div>{props.profile.familySharing !== 'denied' && <button className="btn-secondary" onClick={props.onRevokeSharing}>暂停共享</button>}</section>

    <div className="family-secondary-nav"><button className="btn-secondary" onClick={() => props.onViewChange('detail')}>健康详细变化</button><button className="btn-secondary" onClick={() => props.onViewChange('report')}>这一周发生了什么</button></div>
  </div>;
}
