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
              : '今天没有需要您操心的事情。想找东西、记事情或说说身体情况，直接告诉我。'}
          </p>
        </div>
        <div className="big-help">帮我</div>
      </section>

      <section className="card task-card">
        <div className="section-head">
          <div>
            <h3>今天要做的事</h3>
            <span className="muted">
              完成 {summary.completed} · 进行中 {summary.inProgress} · 待处理 {summary.pending}
            </span>
          </div>
        </div>
        {tasks.length === 0 ? (
          <p className="family-empty">今天没有需要您处理的事情。需要帮忙时，直接告诉我。</p>
        ) : (
          <div className="task-list">
            {tasks.map((task) => (
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
      </section>

      {familyAsk && (
        <section className="card privacy-card">
          <h3>要告诉家里人吗？</h3>
          <p>我发现有一件事情值得关注。除非您同意，我不会把普通聊天直接告诉家属。</p>
          <div className="privacy-actions">
            <button className="btn-primary" onClick={onRequestFamilyShare}>
              告诉家属
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
            <h3>拍照记录</h3>
            <span className="muted">当前为 Demo：不会真的读取图片内容，上传后写入明确标注的示例数据。</span>
          </div>
        </div>
        <div className="chat-input-row">
          <select
            aria-label="选择拍照数据类型"
            value={photoKind}
            onChange={(event) => setPhotoKind(event.target.value as DemoImageKind)}
          >
            <option value="bloodPressure">血压计</option>
            <option value="weight">体重秤</option>
            <option value="report">体检/报告</option>
          </select>
          <button className="btn-primary" onClick={choosePhoto}>
            选择照片
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
            <span className="muted">邀请码只用于演示绑定，真实产品需要账号与服务端校验。</span>
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

      <ChatView chat={chat} onSend={onSend} quickInputs={quickInputs} />
    </div>
  );
}
