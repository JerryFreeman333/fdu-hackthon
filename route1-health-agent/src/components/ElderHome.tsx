import type { CareTask, ElderProfile, FamilyLink, Finding } from '../types';
import type { HomeTwinConnection } from '../hooks/useHomeTwinIntegration';
import type { CrossDeviceStatus } from '../hooks/useCrossDeviceSync';
import HoldToTalk from './HoldToTalk';

interface ElderHomeProps {
  profile: ElderProfile;
  tasks: CareTask[];
  findings: Finding[];
  onTaskStatus: (taskId: string, status: CareTask['status']) => void;
  onTaskOpen: (task: CareTask) => void;
  onOpenAssistant: (text?: string) => void;
  onOpenHealth: () => void;
  onOpenHomeSpace: () => void;
  onRequestFamilyShare: () => void;
  onKeepFamilyPrivate: () => void;
  familyLink: FamilyLink | null;
  syncStatus: CrossDeviceStatus;
  homeTwin: HomeTwinConnection;
}

function taskTime(task: CareTask): string {
  const anyTask = task as CareTask & { time?: string };
  return anyTask.time || (task.kind === 'medication_check' ? '今日' : '待办');
}

export default function ElderHome({
  profile,
  tasks,
  findings,
  onTaskStatus,
  onTaskOpen,
  onOpenAssistant,
  onOpenHealth,
  onOpenHomeSpace,
  onRequestFamilyShare,
  onKeepFamilyPrivate,
}: ElderHomeProps) {
  const activeTasks = tasks
    .filter((task) => task.status !== 'completed' && task.status !== 'dismissed')
    // 家属共享由下方唯一的授权卡处理，不能把同一 finding 再包装成一条重复待办。
    .filter((task) => task.kind !== 'contact_family')
    .filter((task, index, list) => list.findIndex((candidate) => candidate.title === task.title) === index);
  const gentleChanges = findings.filter((finding) => finding.severity === 'watch');
  const importantChanges = findings.filter((finding) => finding.severity === 'alert' || finding.severity === 'urgent');
  const familyAsk = profile.familySharing === 'ask' && importantChanges.length > 0;

  return (
    <div className="elder-home-page">
      <section className="elder-welcome">
        <div>
          <span className="page-kicker">您好</span>
          <h1>{profile.name}</h1>
          <p>{gentleChanges.length > 0 ? '最近有一点变化，我会帮您安静留意。' : '今天也会陪您把事情一件件做好。'}</p>
        </div>
        <div className="today-date" aria-label="今天">
          <strong>今天</strong>
          <span>
            {new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date())}
          </span>
        </div>
      </section>

      <section className="voice-launch-section" aria-label="AI 助手入口">
        <HoldToTalk onText={onOpenAssistant} />
        <h2>有事，和我说说</h2>
        <p>身体不舒服、想记事情、找东西，都可以说</p>
        <button className="btn-secondary" onClick={() => onOpenAssistant()}>
          打字聊天
        </button>
      </section>

      <section className="home-shortcuts" aria-label="常用入口">
        <button className="home-shortcut home-shortcut-health" type="button" onClick={onOpenHealth}>
          <span className="shortcut-symbol shortcut-heart" aria-hidden="true" />
          <strong>我的健康</strong>
          <span>{importantChanges.length > 0 ? `${importantChanges.length} 项变化需要留意` : '查看状态和记录'}</span>
        </button>
        <button className="home-shortcut home-shortcut-space" type="button" onClick={onOpenHomeSpace}>
          <span className="shortcut-symbol shortcut-home" aria-hidden="true" />
          <strong>家庭空间</strong>
          <span>找东西、找药、问路线</span>
        </button>
      </section>

      <section className="card today-card">
        <div className="section-head compact-section-head">
          <div>
            <span className="page-kicker">TODAY</span>
            <h2>今天要做的事</h2>
          </div>
          <span className="task-count">{activeTasks.length} 件</span>
        </div>
        {activeTasks.length === 0 ? (
          <div className="calm-empty">
            <strong>今天没有必须处理的事情</strong>
            <span>需要帮助时，直接和我说。</span>
          </div>
        ) : (
          <div className="today-list">
            {activeTasks.slice(0, 3).map((task) => (
              <article className="today-row" key={task.id}>
                <div className={`today-symbol today-symbol-${task.kind}`} aria-hidden="true" />
                <div className="today-copy">
                  <span>{taskTime(task)}</span>
                  <strong>{task.title}</strong>
                  <small>{task.description}</small>
                </div>
                <button className="today-open" type="button" onClick={() => onTaskOpen(task)}>
                  查看
                </button>
                <button className="today-done" type="button" onClick={() => onTaskStatus(task.id, 'completed')}>
                  完成
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      {familyAsk && (
        <section className="card consent-prompt">
          <span className="page-kicker">由您决定</span>
          <h2>要把以下健康变化告诉家属吗？</h2>
          <p>{importantChanges.map((finding) => finding.title).join('；')}。普通聊天不会直接转给家属。</p>
          <div className="consent-actions">
            <button className="btn-primary" onClick={onRequestFamilyShare}>
              告诉家属
            </button>
            <button className="btn-secondary" onClick={onKeepFamilyPrivate}>
              暂时不用
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
