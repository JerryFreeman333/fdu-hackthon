import { useState } from 'react';
import type {
  CareTask,
  DayRecord,
  ElderProfile,
  FamilyHealthEvent,
  FamilyLink,
  Finding,
  Observation,
} from '../types';
import type { FamilyNotification } from '../engine/escalate';
import type { HomeSafetyAction } from '../adapters/HomeSafetyActionAdapter';
import { SYMPTOM_LABELS } from '../types';
import { familyStatusLabel, familySubjectLabel } from '../engine/familyLedger';
import { severityBadge } from '../engine/escalate';
import ProfileView from './ProfileView';
import ReportView from './ReportView';

interface FamilyDashboardProps {
  profile: ElderProfile;
  familyLink: FamilyLink | null;
  notifications: FamilyNotification[];
  findings: Finding[];
  familyEvents: FamilyHealthEvent[];
  tasks: CareTask[];
  homeSafetyActions: HomeSafetyAction[];
  records: DayRecord[];
  observations: Observation[];
  today: string;
  onTaskStatus: (taskId: string, status: CareTask['status']) => void;
  onHomeSafetyActionStatus: (actionId: string, status: HomeSafetyAction['status']) => void;
  onContactElder: () => void;
  onRevokeSharing: () => void;
  onBindFamily: (inviteCode: string) => boolean;
  onViewChange: (view: 'home' | 'detail' | 'report') => void;
  view: 'home' | 'detail' | 'report';
}

function overallMessage(notifications: FamilyNotification[]) {
  if (notifications.some((n) => n.finding.severity === 'urgent')) {
    return {
      title: '今天需要立即介入',
      detail: '出现需要马上确认安全情况的信号。请先联系老人并按提示的安全路径处理。',
      tone: 'danger',
    };
  }
  if (notifications.some((n) => n.finding.severity === 'alert')) {
    return {
      title: '今天有一件事值得关注',
      detail: '系统把多项近期变化放在一起看后，建议今天主动联系老人确认状态。',
      tone: 'warn',
    };
  }
  return {
    title: '今天总体正常',
    detail: '暂时没有需要家属介入的明显变化。系统会继续观察，发生变化再提醒您。',
    tone: 'ok',
  };
}

export default function FamilyDashboard(props: FamilyDashboardProps) {
  const [inviteCode, setInviteCode] = useState('');
  const [bindError, setBindError] = useState<string | null>(null);
  const state = overallMessage(props.notifications);
  const familyFindings = props.findings.filter((finding) => finding.familyEligible !== false);
  const familyObservations = props.observations.filter((observation) => observation.visibility !== 'private');
  const canViewSharedDetail = props.profile.familySharing === 'granted';
  const recentFamilyEvents = props.familyEvents.slice(-5).reverse();
  const openHomeActions = props.homeSafetyActions.filter((action) => action.status !== 'resolved').slice(0, 3);

  if (props.view === 'detail') {
    if (!canViewSharedDetail) {
      return (
        <div className="card privacy-card">
          <h3>当前未共享详细健康资料</h3>
          <p>老人尚未授权家属查看详细健康资料。需要了解情况，请直接联系老人。</p>
          <button className="btn-primary" onClick={props.onContactElder}>
            联系老人
          </button>
        </div>
      );
    }
    return (
      <div className="family-detail">
        <div className="family-back">
          <button className="btn-secondary" onClick={() => props.onViewChange('home')}>
            ← 返回
          </button>
          <button className="btn-secondary" onClick={() => props.onViewChange('report')}>
            查看周报
          </button>
        </div>
        <ProfileView
          records={props.records}
          observations={familyObservations}
          findings={familyFindings}
          today={props.today}
        />
        {recentFamilyEvents.length > 0 && (
          <section className="card">
            <div className="section-head">
              <div>
                <h3>家人近况记录</h3>
                <span className="muted">这些内容来自老人主动提到的家人情况，不会混入老人的健康档案。</span>
              </div>
            </div>
            <div className="family-feed">
              {recentFamilyEvents.map((event) => (
                <div className="family-item" key={event.id}>
                  <div className="finding-head">
                    <span className="badge badge-info">{familySubjectLabel(event.subject)}</span>
                    <b>{event.tags.map((tag) => SYMPTOM_LABELS[tag]).join('、')}</b>
                    <span className="muted right">{event.timestamp.slice(0, 10)}</span>
                  </div>
                  <p>{event.text}</p>
                  <span className="muted">状态：{familyStatusLabel(event.status)}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  if (props.view === 'report') {
    if (!canViewSharedDetail) {
      return (
        <div className="card privacy-card">
          <h3>当前未共享周报</h3>
          <p>老人尚未授权家属查看周报。需要了解情况，请直接联系老人。</p>
          <button className="btn-primary" onClick={props.onContactElder}>
            联系老人
          </button>
        </div>
      );
    }
    return (
      <div className="family-detail">
        <div className="family-back">
          <button className="btn-secondary" onClick={() => props.onViewChange('home')}>
            ← 返回
          </button>
        </div>
        <ReportView
          records={props.records}
          observations={familyObservations}
          findings={familyFindings}
          tasks={props.tasks}
          today={props.today}
        />
      </div>
    );
  }

  const activeTasks = props.tasks
    .filter((task) => task.status !== 'completed' && task.status !== 'dismissed')
    .slice(0, 3);

  function bind() {
    const ok = props.onBindFamily(inviteCode.trim());
    setBindError(ok ? null : '邀请码无效或已失效，请让老人重新生成。');
  }

  if (props.familyLink?.status !== 'active') {
    return (
      <div className="family-dashboard">
        <section className="card privacy-card">
          <div className="eyebrow">家属端</div>
          <h2>先完成家庭绑定</h2>
          <p>在本地 Demo 中，未绑定前不会展示老人的健康变化或家属通知。</p>
          {props.familyLink?.inviteCode && (
            <p>
              老人当前邀请码：<strong>{props.familyLink.inviteCode}</strong>
            </p>
          )}
          <div className="chat-input-row">
            <input
              className="chat-input"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="例如 AN-2026-1234"
            />
            <button className="btn-primary" onClick={bind}>
              绑定
            </button>
          </div>
          {bindError && <p className="muted">{bindError}</p>}
          <p className="muted">这是演示访问控制；真实产品必须由服务端账号、授权与会话共同校验。</p>
        </section>
      </div>
    );
  }

  return (
    <div className="family-dashboard">
      <section className={`family-status card status-${state.tone}`}>
        <div className="eyebrow">{props.profile.name} · 家属端</div>
        <h2>{state.title}</h2>
        <p>{state.detail}</p>
        <div className="family-actions">
          <button className="btn-primary" onClick={props.onContactElder}>
            📞 联系老人
          </button>
          <button className="btn-secondary" onClick={() => props.onViewChange('detail')}>
            查看详细变化
          </button>
        </div>
      </section>

      {openHomeActions.length > 0 && (
        <section className="card">
          <div className="section-head">
            <div>
              <h3>居家安全，需要您做的一件事</h3>
              <span className="muted">来自 Home Twin × Person Twin，只呈现可执行建议。</span>
            </div>
          </div>
          <div className="family-feed">
            {openHomeActions.map((action) => (
              <div className="family-item family-item-alert" key={action.id}>
                <div className="finding-head">
                  <span className="badge badge-alert">居家安全</span>
                  <b>{action.title}</b>
                </div>
                <p>{action.description}</p>
                <div className="care-path">
                  <b>建议行动：</b>
                  {action.action}
                </div>
                {action.requiresRescan ? (
                  <span className="muted">完成后还需要重新扫描，系统确认风险是否消失。</span>
                ) : (
                  <span className="muted">当前任务无需复扫确认。</span>
                )}
                <div className="family-actions">
                  {action.status === 'open' && (
                    <button
                      className="btn-secondary"
                      onClick={() => props.onHomeSafetyActionStatus(action.id, 'done')}
                    >
                      我已处理
                    </button>
                  )}
                  {action.status === 'done' && <span className="muted">已处理，等待重新扫描确认</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <div className="section-head">
          <div>
            <h3>现在最需要知道的</h3>
            <span className="muted">不是监控所有指标，只看是否需要您介入。</span>
          </div>
        </div>
        {props.notifications.length === 0 ? (
          <p className="family-empty">目前没有新的家属通知。系统会在真正需要时提醒您。</p>
        ) : (
          <div className="family-feed">
            {props.notifications.slice(0, 3).map((notification) => {
              const badge = severityBadge(notification.finding.severity);
              return (
                <div
                  key={notification.finding.id}
                  className={`family-item family-item-${notification.finding.severity}`}
                >
                  <div className="finding-head">
                    <span className={`badge ${badge.className}`}>{badge.text}</span>
                    <b>{notification.finding.title}</b>
                    <span className="muted right">{notification.finding.date}</span>
                  </div>
                  <p>{notification.message}</p>
                  <span className="muted">为什么现在告诉您：{notification.reason}</span>
                  {notification.actionPath && (
                    <div className="care-path">
                      <b>建议行动：</b>
                      {notification.actionPath}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <h3>家人近况</h3>
            <span className="muted">只显示老人主动分享并授权家属查看的家人事实。</span>
          </div>
        </div>
        {recentFamilyEvents.length === 0 ? (
          <p className="family-empty">目前没有新的家人近况记录。</p>
        ) : (
          <div className="family-feed">
            {recentFamilyEvents.map((event) => (
              <div className="family-item" key={event.id}>
                <div className="finding-head">
                  <span className="badge badge-info">{familySubjectLabel(event.subject)}</span>
                  <b>{event.tags.map((tag) => SYMPTOM_LABELS[tag]).join('、')}</b>
                  <span className="muted right">{event.timestamp.slice(0, 10)}</span>
                </div>
                <p>{event.text}</p>
                <span className="muted">状态：{familyStatusLabel(event.status)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <h3>帮老人把事情做完</h3>
            <span className="muted">提醒不是终点，处理完成才算闭环。</span>
          </div>
        </div>
        {activeTasks.length === 0 ? (
          <p className="family-empty">今天的事情都完成了。</p>
        ) : (
          activeTasks.map((task) => (
            <div className="family-task" key={task.id}>
              <div>
                <strong>{task.title}</strong>
                <p>{task.description}</p>
              </div>
              <button className="btn-secondary" onClick={() => props.onTaskStatus(task.id, 'completed')}>
                标记已完成
              </button>
            </div>
          ))
        )}
      </section>

      <div className="family-secondary-nav">
        <button className="btn-secondary" onClick={() => props.onViewChange('detail')}>
          健康详细变化
        </button>
        <button className="btn-secondary" onClick={() => props.onViewChange('report')}>
          这一周发生了什么
        </button>
      </div>
    </div>
  );
}
