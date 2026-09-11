import { useState } from 'react';
import type { CareTask, ElderProfile, FamilyHealthEvent, FamilyLink, Finding } from '../types';
import type { HomeSafetyAction } from '../adapters/HomeSafetyActionAdapter';
import type { PushPermission } from '../adapters/BrowserNotificationChannel';
import { SYMPTOM_LABELS } from '../types';
import { familyStatusLabel, familySubjectLabel } from '../engine/familyLedger';
import { severityBadge } from '../engine/escalate';
import { countUnacknowledged, describeDeliveries, type FamilyNotificationRecord } from '../engine/notify';
import { familyVisibleFindings, familyVisibleTasksForSharing } from '../engine/familyDisclosure';

interface FamilyDashboardProps {
  profile: ElderProfile;
  familyLink: FamilyLink | null;
  notificationRecords: FamilyNotificationRecord[];
  pushPermission: PushPermission;
  findings: Finding[];
  familyEvents: FamilyHealthEvent[];
  tasks: CareTask[];
  homeSafetyActions: HomeSafetyAction[];
  today: string;
  onTaskStatus: (taskId: string, status: CareTask['status']) => void;
  onHomeSafetyActionStatus: (actionId: string, status: HomeSafetyAction['status']) => void;
  onAcknowledgeNotification: (findingId: string) => void;
  onEnablePush: () => void;
  onContactElder: () => void;
  onContactDoctor: () => void;
  onRevokeSharing: () => void;
  onBindFamily: (inviteCode: string) => boolean;
  onViewChange: (view: 'home' | 'detail' | 'report') => void;
  view: 'home' | 'detail' | 'report';
}

function overallMessage(records: FamilyNotificationRecord[], sharing: ElderProfile['familySharing']) {
  // 送达台账保留已送达的历史（不假装撤回），但横幅只反映当前授权下仍有待行动的信号。
  if (sharing !== 'granted') {
    return {
      title: '今天总体正常',
      detail: '暂时没有需要家属介入的明显变化。系统会继续观察，发生变化再提醒您。',
      tone: 'ok',
    };
  }
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
  const state = overallMessage(props.notificationRecords, props.profile.familySharing);
  const pendingAck = countUnacknowledged(props.notificationRecords);
  const canViewSharedDetail = props.profile.familySharing === 'granted';
  const familyFindings = canViewSharedDetail ? familyVisibleFindings(props.findings) : [];
  const recentFamilyEvents = props.familyEvents.slice(-5).reverse();
  const activeTasks = familyVisibleTasksForSharing(props.tasks, props.findings, props.profile.familySharing).slice(
    0,
    3,
  );
  const openHomeActions = canViewSharedDetail
    ? props.homeSafetyActions.filter((action) => action.status !== 'resolved').slice(0, 3)
    : [];

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
        <section className="card">
          <div className="eyebrow">家属共享摘要</div>
          <h3>只展示需要您介入的变化</h3>
          <p className="muted">不会显示步数、血压曲线、完整健康档案或最近聊天记录。</p>
          {familyFindings.length === 0 ? (
            <p className="family-empty">目前没有需要家属介入的变化。</p>
          ) : (
            <div className="family-feed">
              {familyFindings.map((finding) => (
                <div className={`family-item family-item-${finding.severity}`} key={finding.id}>
                  <div className="finding-head">
                    <span className={`badge ${severityBadge(finding.severity).className}`}>
                      {severityBadge(finding.severity).text}
                    </span>
                    <b>{finding.title}</b>
                    <span className="muted right">{finding.date}</span>
                  </div>
                  <p>{finding.familyMessage ?? '建议联系老人确认当前状态。'}</p>
                  {finding.carePath && (
                    <div className="care-path">
                      <b>建议行动：</b>
                      {finding.carePath}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
        {recentFamilyEvents.length > 0 && (
          <section className="card">
            <div className="section-head">
              <div>
                <h3>家人近况记录</h3>
                <span className="muted">这些内容来自老人主动提到并授权家属查看的家人事实。</span>
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
          <h3>当前未共享家属周报</h3>
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
        <section className="card">
          <div className="eyebrow">家属周报</div>
          <h3>
            {familyFindings.length > 0 ? `本周有 ${familyFindings.length} 项需要您留意` : '本周没有需要您介入的变化'}
          </h3>
          <p className="muted">这份摘要只汇总明确需要家属行动的信息；详细健康资料仍留在老人端。</p>
          {familyFindings.length > 0 && (
            <div className="family-feed">
              {familyFindings.map((finding) => (
                <div className={`family-item family-item-${finding.severity}`} key={finding.id}>
                  <div className="finding-head">
                    <span className={`badge ${severityBadge(finding.severity).className}`}>
                      {severityBadge(finding.severity).text}
                    </span>
                    <b>{finding.title}</b>
                    <span className="muted right">{finding.date}</span>
                  </div>
                  <p>{finding.familyMessage ?? '建议联系老人确认当前状态。'}</p>
                  {finding.carePath && (
                    <div className="care-path">
                      <b>建议行动：</b>
                      {finding.carePath}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {recentFamilyEvents.length > 0 && (
            <div className="family-feed">
              <h4>本周主动分享的家人近况</h4>
              {recentFamilyEvents.map((event) => (
                <div className="family-item" key={event.id}>
                  <div className="finding-head">
                    <span className="badge badge-info">{familySubjectLabel(event.subject)}</span>
                    <b>{event.tags.map((tag) => SYMPTOM_LABELS[tag]).join('、')}</b>
                    <span className="muted right">{event.timestamp.slice(0, 10)}</span>
                  </div>
                  <p>{event.text}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

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
        <div className="family-actions">
          <button className="btn-primary" onClick={props.onContactElder}>
            📞 联系老人
          </button>
          <button className="btn-secondary" onClick={() => props.onViewChange('detail')}>
            查看共享摘要
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
                    <button className="btn-secondary" onClick={() => props.onHomeSafetyActionStatus(action.id, 'done')}>
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
        <PushPermissionLine pushPermission={props.pushPermission} onEnablePush={props.onEnablePush} />
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
                  <span className="muted">送达情况：{describeDeliveries(record)}</span>
                  {record.actionPath && (
                    <div className="care-path">
                      <b>建议行动：</b>
                      {record.actionPath}
                    </div>
                  )}
                  <div className="notif-actions">
                    {record.lifecycle === 'new' ? (
                      <button
                        className="btn-secondary"
                        onClick={() => props.onAcknowledgeNotification(record.findingId)}
                      >
                        确认已知悉
                      </button>
                    ) : (
                      <span className="muted">已确认知悉 ✓</span>
                    )}
                    {record.severity === 'urgent' && (
                      <button className="btn-primary" onClick={props.onContactDoctor}>
                        📞 联系社区医生
                      </button>
                    )}
                  </div>
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
            <span className="muted">这里只显示与家属协同或可共享安全发现直接相关的任务。</span>
          </div>
        </div>
        {activeTasks.length === 0 ? (
          <p className="family-empty">今天没有需要您处理的协同任务。</p>
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
          健康共享摘要
        </button>
        <button className="btn-secondary" onClick={() => props.onViewChange('report')}>
          家属周报
        </button>
      </div>
    </div>
  );
}
