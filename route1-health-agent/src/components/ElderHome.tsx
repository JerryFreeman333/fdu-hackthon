import { useRef, useState } from 'react';
import type { CareTask, ChatMessage, ElderProfile, FamilyLink, Finding } from '../types';
import { METRICS } from '../types';
import type { ParsedHealthData } from '../adapters/ImageHealthParser';
import { sharingLabel } from '../engine/privacy';
import type { DemoImageKind } from '../adapters/DemoImageHealthParser';
import ChatView from './ChatView';
import SafetyActions, { familyCallLabel } from './SafetyActions';
import type { DataMode } from '../store/profileStore';

interface ElderHomeProps {
  profile: ElderProfile;
  chat: ChatMessage[];
  onSend: (text: string) => void | Promise<void>;
  onPhotoImport: (file: Blob, kind: DemoImageKind) => void | Promise<void>;
  onCommitPhoto: () => void;
  onCancelPhoto: () => void;
  pendingPhoto: ParsedHealthData | null;
  pendingPhotoKind: DemoImageKind | null;
  pendingPhotoError: string | null;
  quickInputs: string[];
  tasks: CareTask[];
  findings: Finding[];
  familyLink: FamilyLink | null;
  onTaskStatus: (taskId: string, status: CareTask['status']) => void;
  onRequestFamilyShare: () => void;
  onKeepFamilyPrivate: () => void;
  onRevokeFamilyShare: () => void;
  onGenerateInvite: () => void;
  syncStatus?: import('../hooks/useCrossDeviceSync').CrossDeviceStatus;
  /** 数据模式：决定"数据从哪儿来"卡片的文案（评审 P1-2）。 */
  dataMode?: DataMode;
}

export default function ElderHome({
  profile,
  chat,
  onSend,
  onPhotoImport,
  onCommitPhoto,
  onCancelPhoto,
  pendingPhoto,
  pendingPhotoKind,
  pendingPhotoError,
  quickInputs,
  tasks,
  findings,
  familyLink,
  onTaskStatus,
  onRequestFamilyShare,
  onKeepFamilyPrivate,
  onRevokeFamilyShare,
  onGenerateInvite,
  syncStatus,
  dataMode = 'demo',
}: ElderHomeProps) {
  const gentleChanges = findings.filter((f) => f.severity === 'watch').slice(0, 2);
  const familyAsk =
    profile.familySharing === 'ask' && findings.some((f) => f.severity === 'alert' || f.severity === 'urgent');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoKind, setPhotoKind] = useState<DemoImageKind>('bloodPressure');

  function choosePhoto() {
    fileInputRef.current?.click();
  }

  function openHelp() {
    document.getElementById('elder-chat')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => document.querySelector<HTMLInputElement>('#elder-chat input.chat-input')?.focus(), 250);
  }

  async function handlePhotoChange(file: File | undefined) {
    if (!file) return;
    await onPhotoImport(file, photoKind);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="elder-home">
      <section className="elder-hero card">
        <div>
          <div className="eyebrow">今天</div>
          <h2>{profile.name}，我在这儿。</h2>
          <p>
            {gentleChanges.length
              ? '最近有一点变化，我会安静地帮您留意。需要您做什么，我会直接告诉您。'
              : '今天有什么不舒服、想记件事情，或者只是想说说话，都可以直接告诉我。'}
          </p>
        </div>
        <button className="big-help" type="button" onClick={openHelp} aria-label="开始告诉我今天的情况">
          <span>帮我</span>
          <small>点这里说</small>
        </button>
      </section>

      {/* 紧急求助常驻卡：一键呼救不能藏在聊天里，更不能不存在（评审 P0-1）。 */}
      <section className="card sos-card" aria-label="紧急求助">
        <div className="section-head">
          <div>
            <h3>🆘 紧急求助</h3>
            <span className="muted">突然很不好受，就直接打电话。不用先跟我说话。</span>
          </div>
        </div>
        <SafetyActions profile={profile} />
      </section>

      <ChatView
        id="elder-chat"
        chat={chat}
        onSend={onSend}
        quickInputs={quickInputs}
        profile={profile}
        deviceNote={dataMode}
      />

      <section className="card task-card">
        <div className="section-head">
          <div>
            <h3>今天最需要做的事</h3>
            <span className="muted">不用着急，一件一件来。</span>
          </div>
        </div>
        {tasks.length === 0 ? (
          <p className="family-empty">今天没有需要您处理的事情。需要帮忙时，直接告诉我。</p>
        ) : (
          <div className="task-list">
            {tasks.slice(0, 2).map((task) => (
              <div className={`task-item task-${task.status}`} key={task.id}>
                <div className="task-copy">
                  <strong>{task.title}</strong>
                  <p>{task.description}</p>
                  {task.completionNote && <span className="task-done-note">✓ {task.completionNote}</span>}
                </div>
                {task.status !== 'completed' && task.status !== 'dismissed' ? (
                  <div className="task-actions">
                    {task.status === 'pending' && (
                      <button className="btn-secondary" onClick={() => onTaskStatus(task.id, 'in_progress')}>
                        开始
                      </button>
                    )}
                    {task.actions?.includes('call_family') && profile.familyPhone && (
                      <a className="btn-secondary task-call-btn" href={`tel:${profile.familyPhone}`}>
                        📞 打给{familyCallLabel(profile)}
                      </a>
                    )}
                    {task.actions?.includes('request_share') && profile.familySharing !== 'granted' && (
                      <button className="btn-primary" onClick={onRequestFamilyShare}>
                        让家属知道
                      </button>
                    )}
                    <button className="btn-primary" onClick={() => onTaskStatus(task.id, 'completed')}>
                      完成
                    </button>
                  </div>
                ) : (
                  <span className="task-status-label">{task.status === 'completed' ? '已完成' : '已忽略'}</span>
                )}
              </div>
            ))}
          </div>
        )}
        {tasks.length > 2 && <span className="muted">还有 {tasks.length - 2} 件事，我会稍后再提醒您。</span>}
      </section>

      {familyAsk && (
        <section className="card privacy-card">
          <h3>这件事，要让家属知道吗？</h3>
          <p>
            我发现有一件事情值得关注。您同意以后，遇到需要家属知道的变化，我可以按这个授权告诉家属；普通聊天不会直接转给家属。
          </p>
          <div className="privacy-actions">
            <button className="btn-primary" onClick={onRequestFamilyShare}>
              同意以后需要时告诉家属
            </button>
            <button className="btn-secondary" onClick={onKeepFamilyPrivate}>
              先不告诉
            </button>
            <span className="muted">当前：{sharingLabel(profile.familySharing)}</span>
          </div>
        </section>
      )}

      <section className="card photo-card">
        <div className="section-head">
          <div>
            <h3>记录一下血压、体重或报告</h3>
            <span className="muted">这是 Demo，照片不会真的被自动读出内容；上传后会写入明确标注的示例数据。</span>
          </div>
        </div>
        <div className="chat-input-row">
          <select
            aria-label="要记录什么"
            value={photoKind}
            onChange={(event) => setPhotoKind(event.target.value as DemoImageKind)}
          >
            <option value="bloodPressure">血压</option>
            <option value="weight">体重</option>
            <option value="report">体检报告</option>
          </select>
          <button className="btn-primary" onClick={choosePhoto}>
            拍一张/选一张
          </button>
          <input
            ref={fileInputRef}
            hidden
            type="file"
            accept="image/*"
            onChange={(event) => void handlePhotoChange(event.target.files?.[0])}
          />
        </div>
      </section>

      {pendingPhotoError && (
        <section className="card photo-confirm-card photo-confirm-error">
          <p>{pendingPhotoError}</p>
          <button className="btn-secondary" onClick={onCancelPhoto}>
            好
          </button>
        </section>
      )}

      {pendingPhoto && (
        <section className="card photo-confirm-card">
          <div className="section-head">
            <div>
              <h3>📷 我看到了这些，对吗？</h3>
              <span className="muted">
                {pendingPhotoKind === 'bloodPressure'
                  ? '血压计照片'
                  : pendingPhotoKind === 'weight'
                    ? '体重秤照片'
                    : '体检报告照片'}
                {}— 确认后会写入健康记录。
              </span>
            </div>
          </div>
          <ul className="photo-confirm-list">
            {pendingPhoto.measurements.map((m) => {
              const meta = METRICS[m.metric];
              const conf = typeof m.confidence === 'number' ? ` · 识别可信度 ${Math.round(m.confidence * 100)}%` : '';
              return (
                <li key={m.id}>
                  <b>{meta?.label ?? m.metric}</b>
                  <span>
                    : {m.value.toFixed(meta?.decimals ?? 1)} {meta?.unit ?? m.unit}
                    {conf}
                  </span>
                </li>
              );
            })}
            {pendingPhoto.labResults.map((lab) => {
              const range = lab.referenceRange
                ? ` · 参考 ${lab.referenceRange.low ?? '?'}–${lab.referenceRange.high ?? '?'} ${lab.unit}`
                : '';
              return (
                <li key={lab.id}>
                  <b>{lab.name}</b>
                  <span>
                    : {lab.value} {lab.unit}
                    {range}
                  </span>
                </li>
              );
            })}
          </ul>
          {pendingPhoto.rawText && <p className="muted photo-confirm-raw">{pendingPhoto.rawText}</p>}
          <div className="photo-confirm-actions">
            <button className="btn-primary" onClick={onCommitPhoto}>
              是的，记录下来
            </button>
            <button className="btn-secondary" onClick={onCancelPhoto}>
              不是，重新拍
            </button>
          </div>
        </section>
      )}

      <section className="card data-source-card">
        <div className="section-head">
          <div>
            <h3>数据从哪儿来</h3>
            <span className="muted">这两条路都进入同一个个人基线和变化检测。</span>
          </div>
        </div>
        <ul className="data-source-list">
          <li>
            <b>📱 步数 / 心率 / 睡眠 / 血氧</b>
            <span className="muted">
              —{' '}
              {dataMode === 'demo'
                ? '来自模拟的 iPhone + Apple Watch（演示用本地数据，非真接 HealthKit）'
                : '当前版本未接入真实硬件；接入后会自动进入同一基线与检测'}
            </span>
          </li>
          <li>
            <b>📷 血压 / 体重 / 血糖 / 体检报告</b>
            <span className="muted">— 来自拍照识别或手动录入</span>
          </li>
          <li>
            <b>💬 主诉（"累了"、"喘"、"睡不好"）</b>
            <span className="muted">— 来自聊天</span>
          </li>
        </ul>
      </section>
      <section className="card privacy-card">
        <div className="section-head">
          <div>
            <h3>家庭协同</h3>
            <span className="muted">已经绑定家属后，您可以随时暂停共享。</span>
          </div>
        </div>
        {familyLink?.status === 'active' ? (
          <>
            <p>
              已绑定家属：{familyLink.relation} · {familyLink.displayName}
            </p>
            {profile.familySharing === 'granted' && (
              <button className="btn-secondary" onClick={onRevokeFamilyShare}>
                暂停家属共享
              </button>
            )}
          </>
        ) : familyLink ? (
          <>
            <p>
              请让家属输入这个邀请码：<strong>{familyLink.inviteCode}</strong>
            </p>
            {syncStatus && (
              <p className={`family-sync-banner-elder family-sync-banner-elder-${syncStatus.mode}`}>
                {/* 老人端只说"人话"：不出现 P2P/跨设备/协议等技术词；连接失败的技术细节只给家属端。 */}
                {syncStatus.mode === 'cross-device' && '✅ 已经和家人手机连上了，这边的记录会同步过去。'}
                {syncStatus.mode === 'connecting' && '⏳ 等家人在另一台手机上输入这个邀请码…'}
                {syncStatus.mode === 'failed' && '⚠️ 暂时没连上家人的手机。放心，您记的内容都在，晚点再试一次就行。'}
                {syncStatus.mode === 'local-only' && '现在只能在这一台设备上一起看。'}
              </p>
            )}
          </>
        ) : (
          <button className="btn-primary" onClick={onGenerateInvite}>
            生成家属邀请码
          </button>
        )}
      </section>
    </div>
  );
}
