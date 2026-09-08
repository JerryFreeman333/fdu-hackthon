import { useRef, useState } from 'react';
import type { CareTask, ChatMessage, ElderProfile, FamilyLink, Finding } from '../types';
import { sharingLabel } from '../engine/privacy';
import { taskSummary } from '../engine/tasks';
import type { DemoImageKind } from '../adapters/DemoImageHealthParser';
import ChatView from './ChatView';

interface ElderHomeProps {
  profile: ElderProfile;
  chat: ChatMessage[];
  onSend: (text: string) => void | Promise<void>;
  onPhotoImport: (file: Blob, kind: DemoImageKind) => void | Promise<void>;
  quickInputs: string[];
  tasks: CareTask[];
  findings: Finding[];
  familyLink: FamilyLink | null;
  onTaskStatus: (taskId: string, status: CareTask['status']) => void;
  onRequestFamilyShare: () => void;
  onKeepFamilyPrivate: () => void;
  onRevokeFamilyShare: () => void;
  onGenerateInvite: () => void;
}

export default function ElderHome({
  profile,
  chat,
  onSend,
  onPhotoImport,
  quickInputs,
  tasks,
  findings,
  familyLink,
  onTaskStatus,
  onRequestFamilyShare,
  onKeepFamilyPrivate,
  onRevokeFamilyShare,
  onGenerateInvite,
}: ElderHomeProps) {
  const summary = taskSummary(tasks);
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
          <p>
            请让家属输入这个邀请码：<strong>{familyLink.inviteCode}</strong>
          </p>
        ) : (
          <button className="btn-primary" onClick={onGenerateInvite}>
            生成家属邀请码
          </button>
        )}
      </section>

      <ChatView id="elder-chat" chat={chat} onSend={onSend} quickInputs={quickInputs} />
    </div>
  );
}
