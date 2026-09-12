import { useState, type ReactNode } from 'react';
import type { CareTask, DayRecord, ElderProfile, FamilyHealthEvent, FamilyLink, Finding } from '../types';
import type { FamilyNotification } from '../engine/escalate';
import type { FamilyNotificationRecord } from '../engine/notify';
import { describeDeliveries } from '../engine/notify';
import type { HomeSafetyAction } from '../adapters/HomeSafetyActionAdapter';
import { SYMPTOM_LABELS } from '../types';
import { familyStatusLabel, familySubjectLabel } from '../engine/familyLedger';
import { severityBadge } from '../engine/escalate';
import { familyVisibleFindings, familyVisibleTasksForSharing } from '../engine/familyDisclosure';
import { buildMedicationCareView } from '../engine/medicationCare';
import { familyStatus } from '../engine/dashboardStatus';
import {
  loadWebhookConfig,
  saveWebhookConfig,
  sendWebhookPush,
  type WebhookProvider,
} from '../adapters/WebhookPushChannel';
import type { CrossDeviceStatus } from '../hooks/useCrossDeviceSync';

type FamilyView = 'home' | 'tasks' | 'report' | 'profile' | 'detail' | 'medication';

interface FamilyDashboardProps {
  profile: ElderProfile;
  familyLink: FamilyLink | null;
  notifications: FamilyNotification[];
  dispatchRecords: FamilyNotificationRecord[];
  onAcknowledgeDispatch: (findingId: string) => void;
  /** 协同通道当前状态（local-only / connecting / cross-device / failed） */
  syncStatus: CrossDeviceStatus;
  /** 当前 tab 唯一 ID，仅用于在 UI 上让用户区分自己开的是哪一份 tab */
  tabId: string;
  /** 今日（today）系统收到的主诉/聊天/设备/拍照 信号条数；
   * 0 时 dashboardStatus 不会显示绿色"今天总体正常" */
  todaySignalCount: number;
  /** 今日存在、但因老人未授权而被隐私门控挡住的 alert/urgent 数量（评审 P0-2）：
   * 大于 0 时 dashboardStatus 必须显示"被隐私设置挡住"，绝不显示"今天总体正常" */
  gatedAlertCount: number;
  findings: Finding[];
  familyEvents: FamilyHealthEvent[];
  tasks: CareTask[];
  homeSafetyActions: HomeSafetyAction[];
  /** 路线二 Home Twin 前端入口。开发环境默认 http://localhost:5174。 */
  homeTwinUrl: string;
  records: DayRecord[];
  today: string;
  onTaskStatus: (taskId: string, status: CareTask['status']) => void;
  onHomeSafetyActionStatus: (actionId: string, status: HomeSafetyAction['status']) => void;
  onContactElder: () => void;
  onContactDoctor: () => void;
  onRevokeSharing: () => void;
  onBindFamily: (inviteCode: string) => boolean;
  /** 评审 P0-4：家属端也提供清空本机数据入口（试玩污染同样发生在家属端）。 */
  onClearData?: () => void;
  onViewChange: (view: FamilyView) => void;
  view: FamilyView;
}

function familyActionUrl(base: string, actionId?: string): string {
  try {
    const url = new URL(base, window.location.href);
    url.searchParams.set('role', 'family');
    url.searchParams.set('view', 'family-actions');
    if (actionId) url.searchParams.set('actionId', actionId);
    url.searchParams.set('returnUrl', window.location.href);
    return url.toString();
  } catch {
    return base;
  }
}

const MEDICATION_STATUS_BADGES: Record<CareTask['status'], string> = {
  pending: 'badge badge-watch',
  in_progress: 'badge badge-info',
  completed: 'badge badge-ok',
  dismissed: 'badge badge-muted',
};

function renderSyncBanner(status: CrossDeviceStatus, _tabId: string): ReactNode {
  if (status.mode === 'cross-device') {
    return (
      <div className="family-sync-banner family-sync-banner-cross" role="status">
        <span className="family-sync-dot" aria-hidden="true" />
        <span>已和老人端同步，重要变化会及时更新。</span>
      </div>
    );
  }
  if (status.mode === 'connecting') {
    return (
      <div className="family-sync-banner family-sync-banner-pending" role="status">
        <span className="family-sync-dot" aria-hidden="true" />
        <span>正在连接老人端，请稍候。</span>
      </div>
    );
  }
  if (status.mode === 'failed') {
    return (
      <div className="family-sync-banner family-sync-banner-failed" role="status">
        <span className="family-sync-dot" aria-hidden="true" />
        <span>暂时没有连上老人端。您仍可查看本机已有内容，稍后会自动重试。</span>
      </div>
    );
  }
  return (
    <div className="family-sync-banner" role="status">
      <span className="family-sync-dot" aria-hidden="true" />
      <span>当前只在这台设备同步。如需和老人的手机连接，请使用邀请码完成绑定。</span>
    </div>
  );
}

export default function FamilyDashboard(props: FamilyDashboardProps) {
  const [inviteCode, setInviteCode] = useState('');
  const [bindError, setBindError] = useState<string | null>(null);
  const state = familyStatus(props.notifications, props.dispatchRecords, props.todaySignalCount, props.gatedAlertCount);
  // ===== 微信推送设置（评审 P0-6/P1-3）=====
  const initialWebhook = loadWebhookConfig();
  const [webhookProvider, setWebhookProvider] = useState<WebhookProvider>(initialWebhook?.provider ?? 'serverchan');
  const [webhookToken, setWebhookToken] = useState(initialWebhook?.token ?? '');
  const [webhookCustomUrl, setWebhookCustomUrl] = useState(initialWebhook?.customUrl ?? '');
  const [webhookStatus, setWebhookStatus] = useState<string | null>(null);
  const webhookConfigured = Boolean(loadWebhookConfig());
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
  // 把派发台账按 findingId 建索引，便于在原有通知卡片上叠加送达状态与确认按钮。
  const dispatchByFinding = new Map(props.dispatchRecords.map((record) => [record.findingId, record]));

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

  if (props.view === 'medication') {
    if (!canViewSharedDetail) {
      return (
        <div className="card privacy-card">
          <h3>当前未共享用药信息</h3>
          <p>老人尚未授权家属查看详细用药信息，需要了解情况请直接联系老人。</p>
          <button className="btn-primary" onClick={props.onContactElder}>
            联系老人
          </button>
        </div>
      );
    }
    const medicationCare = buildMedicationCareView({
      medications: props.profile.medications,
      tasks: props.tasks,
      today: props.today,
      familySharing: props.profile.familySharing,
      communityDoctorPhone: props.profile.communityDoctorPhone,
      notifications: props.notifications,
    });
    return (
      <div className="family-detail">
        <div className="family-back">
          <button className="btn-secondary" onClick={() => props.onViewChange('home')}>
            ← 返回
          </button>
        </div>
        <section className="card">
          <div className="eyebrow">用药与医护</div>
          <h3>老人正在吃什么药</h3>
          <p className="muted">只显示老人档案里的当前用药，不代表用药建议；不推断用途或副作用。</p>
          {medicationCare.medications.length === 0 ? (
            <p className="family-empty">暂无药品档案。</p>
          ) : (
            <div className="family-feed">
              {medicationCare.medications.map((medication) => (
                <div className="family-item medication-card" key={medication.raw}>
                  {medication.dose || medication.frequency ? (
                    <>
                      <b>{medication.name}</b>
                      <div className="medication-meta">
                        {medication.dose && <span>剂量：{medication.dose}</span>}
                        {medication.frequency && <span>频次：{medication.frequency}</span>}
                      </div>
                    </>
                  ) : (
                    <b>{medication.raw}</b>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="card">
          <div className="eyebrow">今日服药</div>
          <h3>今天的服药确认</h3>
          {!medicationCare.hasTodayRecord ? (
            <p className="family-empty">今天暂无服药确认记录。</p>
          ) : (
            <div className="family-feed">
              {medicationCare.todayStatuses.map((entry) => (
                <div className="family-item" key={entry.id}>
                  <span className={MEDICATION_STATUS_BADGES[entry.status]}>{entry.label}</span>
                  <span className="medication-meta">状态来自老人端的今日服药确认任务。</span>
                </div>
              ))}
            </div>
          )}
        </section>
        {medicationCare.needsAttention && (
          <section className="card">
            <div className="eyebrow">需要家属处理</div>
            <div className="care-path">
              <b>建议行动：</b>
              {medicationCare.attentionMessage}
            </div>
            <div className="family-actions">
              <button className="btn-primary" onClick={props.onContactElder}>
                📞 联系老人
              </button>
            </div>
          </section>
        )}
        {medicationCare.showDoctorEntry && (
          <section className="card">
            <div className="eyebrow">社区医生</div>
            <h3>医护入口</h3>
            <p className="muted">如需确认用药调整、异常症状或是否需要就医，请联系医生或药师。</p>
            <div className="family-actions">
              <button className="btn-primary" onClick={props.onContactDoctor}>
                📞 联系社区医生
              </button>
            </div>
          </section>
        )}
      </div>
    );
  }

  function bind() {
    const ok = props.onBindFamily(inviteCode.trim());
    setBindError(ok ? null : '邀请码无效或已失效，请让老人重新生成。');
  }

  function saveWebhookSettings() {
    const token = webhookToken.trim();
    if (!token) {
      setWebhookStatus('请先填写推送服务的 token / SendKey。');
      return;
    }
    saveWebhookConfig({
      provider: webhookProvider,
      token,
      customUrl: webhookProvider === 'custom' ? webhookCustomUrl.trim() : undefined,
    });
    setWebhookStatus('已保存。之后派发的紧急通知会同时推送到微信。');
  }

  async function testWebhook() {
    const token = webhookToken.trim();
    if (!token) {
      setWebhookStatus('请先填写推送服务的 token / SendKey。');
      return;
    }
    const config = { provider: webhookProvider, token, customUrl: webhookCustomUrl.trim() || undefined };
    setWebhookStatus('正在发送测试消息…');
    const outcome = await sendWebhookPush(config, {
      title: '安康助手测试消息',
      body: '这是一条测试推送。收到后说明紧急通知可以送到您的微信。',
    });
    if (outcome.status === 'sent') {
      saveWebhookConfig(config);
      setWebhookStatus(`✅ ${outcome.detail}`);
    } else {
      setWebhookStatus(`❌ ${outcome.detail}`);
    }
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

  if (props.view === 'home') {
    const priorityHomeAction = openHomeActions[0];
    const priorityNotification = props.notifications[0];
    const priorityTask = activeTasks[0];
    return (
      <div className="family-dashboard family-home-page">
        <header className="family-welcome">
          <span className="page-kicker">家庭状态</span>
          <h1>您好，{props.familyLink.displayName}</h1>
          <p>这里只告诉您是否需要介入，不展示老人的全部生活数据。</p>
        </header>
        {renderSyncBanner(props.syncStatus, props.tabId)}
        <section className={`family-status card status-${state.tone}`}>
          <div className="family-status-mark" aria-hidden="true" />
          <div>
            <span className="page-kicker">{props.profile.name}</span>
            <h2>{state.title}</h2>
            <p>{state.detail}</p>
          </div>
          <div className="family-actions">
            <button className="btn-primary" onClick={props.onContactElder}>
              联系老人
            </button>
            <button className="btn-secondary" onClick={() => props.onViewChange('tasks')}>
              查看待处理
            </button>
          </div>
        </section>

        <section className="card family-priority-card">
          <div className="section-head compact-section-head">
            <div>
              <span className="page-kicker">现在最需要知道的</span>
              <h2>一件事，一次处理清楚</h2>
            </div>
          </div>
          {priorityHomeAction ? (
            <button className="priority-entry" type="button" onClick={() => props.onViewChange('tasks')}>
              <span className="priority-type">居家安全</span>
              <strong>{priorityHomeAction.title}</strong>
              <p>{priorityHomeAction.description}</p>
              <span className="priority-next">查看原因与处理步骤 →</span>
            </button>
          ) : priorityNotification ? (
            <button className="priority-entry" type="button" onClick={() => props.onViewChange('tasks')}>
              <span className="priority-type">状态变化</span>
              <strong>{priorityNotification.finding.title}</strong>
              <p>{priorityNotification.message}</p>
              <span className="priority-next">查看为什么现在通知您 →</span>
            </button>
          ) : priorityTask ? (
            <button className="priority-entry" type="button" onClick={() => props.onViewChange('tasks')}>
              <span className="priority-type">家庭待办</span>
              <strong>{priorityTask.title}</strong>
              <p>{priorityTask.description}</p>
              <span className="priority-next">去处理 →</span>
            </button>
          ) : (
            <div className="calm-empty">
              <strong>现在没有需要您处理的事情</strong>
              <span>系统有明确变化时再来提醒您。</span>
            </div>
          )}
        </section>

        <section className="family-home-links">
          <button type="button" onClick={() => props.onViewChange('report')}>
            <strong>本周变化</strong>
            <span>查看周报</span>
          </button>
          <button type="button" onClick={() => props.onViewChange('profile')}>
            <strong>家庭与权限</strong>
            <span>管理连接</span>
          </button>
        </section>
      </div>
    );
  }

  if (props.view === 'tasks') {
    return (
      <div className="family-dashboard family-tasks-page">
        <header className="page-title-block">
          <span className="page-kicker">待处理</span>
          <h1>需要您介入的事情</h1>
          <p>按优先级整理健康变化、家庭风险和协同任务。</p>
        </header>

        {openHomeActions.map((action) => (
          <section className="card action-detail-card" key={action.id}>
            <div className="action-detail-head">
              <span className="badge badge-alert">居家安全</span>
              <span>{action.status === 'done' ? '已处理，待复扫' : '待处理'}</span>
            </div>
            <h2>{action.title}</h2>
            <dl className="action-story">
              <div>
                <dt>发生了什么</dt>
                <dd>{action.description}</dd>
              </div>
              <div>
                <dt>为什么现在处理</dt>
                <dd>这项家庭环境变化与老人当前行动状态相关，需要家人确认。</dd>
              </div>
              <div>
                <dt>现在做什么</dt>
                <dd>{action.action}</dd>
              </div>
            </dl>
            <div className="family-actions">
              {action.status === 'open' && (
                <button className="btn-primary" onClick={() => props.onHomeSafetyActionStatus(action.id, 'done')}>
                  我已处理
                </button>
              )}
              <a className="btn-secondary" href={familyActionUrl(props.homeTwinUrl, action.id)}>
                查看空间证据
              </a>
            </div>
            {action.requiresRescan && <p className="muted">完成操作不等于风险消失，需要重新扫描后才能关闭。</p>}
          </section>
        ))}

        {props.notifications.map((notification) => {
          const badge = severityBadge(notification.finding.severity);
          const dispatch = dispatchByFinding.get(notification.finding.id);
          return (
            <section className="card action-detail-card" key={notification.finding.id}>
              <div className="action-detail-head">
                <span className={`badge ${badge.className}`}>{badge.text}</span>
                <span>{notification.finding.date}</span>
              </div>
              <h2>{notification.finding.title}</h2>
              <dl className="action-story">
                <div>
                  <dt>发生了什么</dt>
                  <dd>{notification.message}</dd>
                </div>
                <div>
                  <dt>为什么现在告诉您</dt>
                  <dd>{notification.reason}</dd>
                </div>
                <div>
                  <dt>建议行动</dt>
                  <dd>{notification.actionPath ?? '建议先联系老人确认当前状态。'}</dd>
                </div>
              </dl>
              <div className="family-actions">
                <button className="btn-primary" onClick={props.onContactElder}>
                  联系老人
                </button>
                {dispatch?.lifecycle === 'new' && (
                  <button className="btn-secondary" onClick={() => props.onAcknowledgeDispatch(dispatch.findingId)}>
                    我已知悉
                  </button>
                )}
                <button className="btn-secondary" onClick={() => props.onViewChange('detail')}>
                  查看共享摘要
                </button>
              </div>
              {dispatch && <p className="muted">送达状态：{describeDeliveries(dispatch)}</p>}
            </section>
          );
        })}

        {activeTasks.map((task) => (
          <section className="card action-detail-card" key={task.id}>
            <div className="action-detail-head">
              <span className="badge badge-info">家庭待办</span>
              <span>{task.status === 'in_progress' ? '处理中' : '待处理'}</span>
            </div>
            <h2>{task.title}</h2>
            <p>{task.description}</p>
            <button className="btn-secondary" onClick={() => props.onTaskStatus(task.id, 'completed')}>
              标记已完成
            </button>
          </section>
        ))}

        {openHomeActions.length + props.notifications.length + activeTasks.length === 0 && (
          <section className="card calm-empty">
            <strong>目前没有待处理事项</strong>
            <span>系统会在真正需要时通知您。</span>
          </section>
        )}
      </div>
    );
  }

  if (props.view === 'profile') {
    return (
      <div className="family-dashboard family-profile-page">
        <header className="page-title-block">
          <span className="page-kicker">我的</span>
          <h1>家庭、权限与通知</h1>
          <p>管理连接和接收方式，不在这里堆健康数据。</p>
        </header>
        <section className="settings-list card">
          <div className="settings-row">
            <span>
              <strong>已绑定老人</strong>
              <small>{props.profile.name}</small>
            </span>
            <span>{props.familyLink.relation}</span>
          </div>
          <button type="button" onClick={() => props.onViewChange('medication')}>
            <span>
              <strong>用药与医护</strong>
              <small>查看老人授权共享的药物和今日确认</small>
            </span>
            <b>›</b>
          </button>
          <button type="button" onClick={() => props.onViewChange('detail')}>
            <span>
              <strong>健康共享摘要</strong>
              <small>只查看得到授权的重要变化</small>
            </span>
            <b>›</b>
          </button>
        </section>

        <section className="card webhook-settings-card">
          <span className="page-kicker">通知方式</span>
          <h2>微信接收紧急通知</h2>
          <p className="muted">token 只保存在本机。正式产品应由服务端安全发送。</p>
          <div className="webhook-form">
            <label htmlFor="webhook-provider">推送服务</label>
            <select
              id="webhook-provider"
              value={webhookProvider}
              onChange={(event) => setWebhookProvider(event.target.value as WebhookProvider)}
            >
              <option value="serverchan">Server酱</option>
              <option value="pushplus">PushPlus</option>
              <option value="custom">自定义 Webhook</option>
            </select>
            {webhookProvider === 'custom' && (
              <input
                value={webhookCustomUrl}
                onChange={(event) => setWebhookCustomUrl(event.target.value)}
                placeholder="https://your-server.example.com/push"
              />
            )}
            <label htmlFor="webhook-token">SendKey / Token</label>
            <input
              id="webhook-token"
              value={webhookToken}
              onChange={(event) => setWebhookToken(event.target.value)}
              placeholder="SCT… / 推送 token"
              autoComplete="off"
            />
            <div className="webhook-actions">
              <button className="btn-secondary" onClick={testWebhook}>
                发送测试消息
              </button>
              <button className="btn-primary" onClick={saveWebhookSettings}>
                保存
              </button>
            </div>
            {webhookStatus && <p className="muted webhook-status">{webhookStatus}</p>}
            {webhookConfigured && !webhookStatus && <p className="muted">当前已配置微信推送</p>}
          </div>
        </section>

        <section className="settings-danger-zone">
          <button className="btn-secondary" onClick={props.onRevokeSharing}>
            暂停老人共享
          </button>
          {props.onClearData && (
            <button className="danger-text-button" onClick={props.onClearData}>
              清空本机全部数据
            </button>
          )}
        </section>
      </div>
    );
  }

  const syncBanner = renderSyncBanner(props.syncStatus, props.tabId);
  return (
    <div className="family-dashboard">
      {syncBanner}
      <section className={`family-status card status-${state.tone}`}>
        <div className="eyebrow">{props.profile.name} · 家属端</div>
        <h2>{state.title}</h2>
        <p>{state.detail}</p>
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
          <a className="btn-primary home-twin-link" href={props.homeTwinUrl}>
            进入 3D 居家安全
          </a>
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
              const dispatch = dispatchByFinding.get(notification.finding.id);
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
                  {dispatch && (
                    <div className="delivery-ledger">
                      <span className="muted">送达：{describeDeliveries(dispatch)}</span>
                      {dispatch.lifecycle === 'new' ? (
                        <button
                          className="btn-secondary"
                          onClick={() => props.onAcknowledgeDispatch(dispatch.findingId)}
                        >
                          我已知悉
                        </button>
                      ) : (
                        <span className="muted">您已确认 · {dispatch.acknowledgedAt?.slice(11, 16)}</span>
                      )}
                    </div>
                  )}
                  {notification.finding.severity === 'urgent' && (
                    <div className="notif-actions">
                      <button className="btn-primary" onClick={props.onContactDoctor}>
                        📞 联系社区医生
                      </button>
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
        <button className="btn-secondary" onClick={() => props.onViewChange('medication')}>
          用药与医护
        </button>
        <button className="btn-secondary" onClick={() => props.onViewChange('report')}>
          家属周报
        </button>
      </div>

      {props.onClearData && (
        <details className="advanced-details">
          <summary>数据与设置</summary>
          <div className="card webhook-settings-card">
            <h3>微信接收紧急通知</h3>
            <p className="muted">
              配置后，派发的紧急通知会同时推送到您的微信——不需要一直开着这个网页。
              当前演示版从这台设备发出；正式版由服务端发送。token 只保存在本机，不会上传。
            </p>
            <div className="webhook-form">
              <label htmlFor="webhook-provider">推送服务</label>
              <select
                id="webhook-provider"
                value={webhookProvider}
                onChange={(event) => setWebhookProvider(event.target.value as WebhookProvider)}
              >
                <option value="serverchan">Server酱（sct.ftqq.com）</option>
                <option value="pushplus">PushPlus（pushplus.plus）</option>
                <option value="custom">自定义 Webhook</option>
              </select>
              {webhookProvider === 'custom' ? (
                <>
                  <label htmlFor="webhook-custom-url">接收地址（https 或 localhost）</label>
                  <input
                    id="webhook-custom-url"
                    value={webhookCustomUrl}
                    onChange={(event) => setWebhookCustomUrl(event.target.value)}
                    placeholder="https://your-server.example.com/push"
                  />
                  <label htmlFor="webhook-token">通道标识</label>
                </>
              ) : (
                <label htmlFor="webhook-token">SendKey / Token</label>
              )}
              <input
                id="webhook-token"
                value={webhookToken}
                onChange={(event) => setWebhookToken(event.target.value)}
                placeholder="SCT… / 推送 token"
                autoComplete="off"
              />
              <div className="webhook-actions">
                <button className="btn-secondary" onClick={testWebhook}>
                  发送测试消息
                </button>
                <button className="btn-secondary" onClick={saveWebhookSettings}>
                  保存
                </button>
              </div>
              {webhookStatus && <p className="muted webhook-status">{webhookStatus}</p>}
              {webhookConfigured && !webhookStatus && <p className="muted">当前已配置微信推送 ✓（修改后记得保存）</p>}
            </div>
          </div>
          <div className="card data-reset-card">
            <p className="muted">
              清空这台浏览器里的全部数据（聊天、健康记录、通知台账、协同设置），并回到初始选择。删除后无法恢复。
            </p>
            <button className="btn-secondary" onClick={props.onClearData}>
              清空本机全部数据
            </button>
          </div>
        </details>
      )}
    </div>
  );
}
