import { useState } from 'react';
import type { CareTask, DayRecord, ElderProfile, FamilyLink, Finding, Observation } from '../types';
import { severityBadge } from '../engine/escalate';
import { countUnacknowledged, describeDeliveries, type FamilyNotificationRecord } from '../engine/notify';
import type { PushPermission } from '../adapters/BrowserNotificationChannel';
import ProfileView from './ProfileView';
import ReportView from './ReportView';

interface FamilyDashboardProps {
  profile: ElderProfile;
  familyLink: FamilyLink | null;
  notificationRecords: FamilyNotificationRecord[];
  findings: Finding[];
  tasks: CareTask[];
  records: DayRecord[];
  observations: Observation[];
  today: string;
  pushPermission: PushPermission;
  onTaskStatus: (taskId: string, status: CareTask['status']) => void;
  onContactElder: () => void;
  onRevokeSharing: () => void;
  onBindFamily: (inviteCode: string) => boolean;
  onAcknowledgeNotification: (findingId: string) => void;
  onEnablePush: () => void;
  onViewChange: (view: 'home' | 'detail' | 'report') => void;
  view: 'home' | 'detail' | 'report';
}

function overallMessage(records: FamilyNotificationRecord[]) {
  if (records.some((record) => record.severity === 'urgent' && record.lifecycle === 'new')) {
    return {
      title: '今天需要立即介入',
      detail: '出现需要马上确认安全情况的信号。请先联系老人并按提示的安全路径处理。',
      tone: 'danger',
    };
  }
  if (records.some((record) => record.severity === 'alert' && record.lifecycle === 'new')) {
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

function formatClock(iso: string, today: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const hhmm = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  const day = date.toISOString().slice(0, 10);
  return day === today ? hhmm : `${day.slice(5)} ${hhmm}`;
}

function PushPermissionLine(props: Pick<FamilyDashboardProps, 'pushPermission' | 'onEnablePush'>) {
  switch (props.pushPermission) {
    case 'granted':
      return <p className="muted push-line">系统通知：已开启 ✓ 新通知会同时推送到系统通知栏。</p>;
    case 'denied':
      return (
        <p className="muted push-line">
          系统通知权限已被拒绝：新通知只会保留在本页通知中心，不会推送到系统通知栏。如需推送，请在浏览器/系统设置中允许本站通知。
        </p>
      );
    case 'unsupported':
      return <p className="muted push-line">当前浏览器不支持系统通知：新通知会保留在本页通知中心。</p>;
    default:
      return (
        <div className="push-line">
          <button className="btn-secondary" onClick={props.onEnablePush}>
            开启系统通知
          </button>
          <p className="muted">开启后，即使您停留在其他页面，紧急通知也会推送到系统通知栏。</p>
        </div>
      );
  }
}

export default function FamilyDashboard(props: FamilyDashboardProps) {
  const [inviteCode, setInviteCode] = useState('');
  const [bindError, setBindError] = useState<string | null>(null);
  const state = overallMessage(props.notificationRecords);
  const pendingAck = countUnacknowledged(props.notificationRecords);
  const familyFindings = props.findings.filter((finding) => finding.familyEligible !== false);
  const familyObservations = props.observations.filter((observation) => observation.visibility !== 'private');
  const canViewSharedDetail = props.profile.familySharing === 'granted';

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
        <p>
          {state.detail}
          {pendingAck > 0 ? ` 当前有 ${pendingAck} 条通知等待您确认。` : ''}
        </p>
        <PushPermissionLine pushPermission={props.pushPermission} onEnablePush={props.onEnablePush} />
        <div className="family-actions">
          <button className="btn-primary" onClick={props.onContactElder}>
            📞 联系老人
          </button>
          <button className="btn-secondary" onClick={() => props.onViewChange('detail')}>
            查看详细变化
          </button>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <h3>现在最需要知道的</h3>
            <span className="muted">不是监控所有指标，只看是否需要您介入。</span>
          </div>
        </div>
        {props.notificationRecords.length === 0 ? (
          <p className="family-empty">目前没有新的家属通知。系统会在真正需要时提醒您。</p>
        ) : (
          <div className="family-feed">
            {props.notificationRecords.slice(0, 5).map((record) => {
              const badge = severityBadge(record.severity);
              return (
                <div
                  key={record.findingId}
                  className={`family-item family-item-${record.severity} ${
                    record.lifecycle === 'acknowledged' ? 'family-item-ack' : ''
                  }`}
                >
                  <div className="finding-head">
                    <span className={`badge ${badge.className}`}>{badge.text}</span>
                    <b>{record.title}</b>
                    <span className="muted right">{formatClock(record.createdAt, props.today)}</span>
                  </div>
                  <p>{record.message}</p>
                  <span className="muted">为什么现在告诉您：{record.reason}</span>
                  {record.actionPath && (
                    <div className="care-path">
                      <b>建议行动：</b>
                      {record.actionPath}
                    </div>
                  )}
                  <div className="notif-delivery muted">送达情况：{describeDeliveries(record)}</div>
                  {record.lifecycle === 'new' ? (
                    <button
                      className="btn-primary notif-ack-btn"
                      onClick={() => props.onAcknowledgeNotification(record.findingId)}
                    >
                      确认已知悉
                    </button>
                  ) : (
                    <span className="notif-ack">
                      ✓ 已确认 {formatClock(record.acknowledgedAt ?? record.createdAt, props.today)}
                    </span>
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
