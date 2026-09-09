import { useRef, useState } from 'react';
import type { CareTask, ChatMessage, ElderProfile, FamilyLink, Finding, HealthMeasurement, LabResult } from '../types';
import { sharingLabel } from '../engine/privacy';
import type { DemoImageKind } from '../adapters/DemoImageHealthParser';
import type { PendingPhotoImport } from '../adapters/ImageHealthParser';
import { METRICS } from '../types';
import ChatView from './ChatView';

interface ElderHomeProps {
  profile: ElderProfile;
  chat: ChatMessage[];
  onSend: (text: string) => void | Promise<void>;
  /** 拍照第一步：返回待用户确认的解析预览，**不会自动写入**。 */
  onPhotoImport: (file: Blob, kind: DemoImageKind) => Promise<PendingPhotoImport | null>;
  /** 拍照第二步：用户在 UI 上点"确认保存"才真正写入。 */
  onCommitPhoto: (pending: PendingPhotoImport) => boolean;
  /** 当前激活的 parser 模式，用于提示用户当前是 Demo 还是真实识别。 */
  imageParserMode: 'real-http' | 'demo';
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

type PendingState =
  | { status: 'idle' }
  | { status: 'parsing'; fileName: string }
  | { status: 'review'; pending: PendingPhotoImport; fileName: string };

const KIND_LABEL: Record<DemoImageKind, string> = {
  bloodPressure: '血压',
  weight: '体重',
  report: '体检报告',
};

const DETECTED_LABEL: Record<PendingPhotoImport['detectedKind'], string> = {
  bloodPressure: '血压',
  weight: '体重',
  report: '体检报告',
  unknown: '未识别',
};

export default function ElderHome({
  profile,
  chat,
  onSend,
  onPhotoImport,
  onCommitPhoto,
  imageParserMode,
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
  const gentleChanges = findings.filter((f) => f.severity === 'watch').slice(0, 2);
  const familyAsk =
    profile.familySharing === 'ask' && findings.some((f) => f.severity === 'alert' || f.severity === 'urgent');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoKind, setPhotoKind] = useState<DemoImageKind>('bloodPressure');
  const [pending, setPending] = useState<PendingState>({ status: 'idle' });

  // 编辑态：识别结果允许手动改值/单位
  const [editingMeasurements, setEditingMeasurements] = useState<HealthMeasurement[]>([]);
  const [editingLabs, setEditingLabs] = useState<LabResult[]>([]);

  function resetSelection() {
    setPending({ status: 'idle' });
    setEditingMeasurements([]);
    setEditingLabs([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function choosePhoto() {
    fileInputRef.current?.click();
  }

  function openHelp() {
    document.getElementById('elder-chat')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => document.querySelector<HTMLInputElement>('#elder-chat input.chat-input')?.focus(), 250);
  }

  async function handlePhotoChange(file: File | undefined) {
    if (!file) return;
    const fileName = file.name || '未命名';
    setPending({ status: 'parsing', fileName });
    const result = await onPhotoImport(file, photoKind);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!result) {
      resetSelection();
      return;
    }
    setEditingMeasurements(result.measurements.map((m) => ({ ...m })));
    setEditingLabs(result.labResults.map((l) => ({ ...l })));
    setPending({ status: 'review', pending: result, fileName });
  }

  function updateMeasurement(index: number, patch: Partial<HealthMeasurement>) {
    setEditingMeasurements((current) =>
      current.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    );
  }

  function updateLab(index: number, patch: Partial<LabResult>) {
    setEditingLabs((current) =>
      current.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    );
  }

  function handleConfirm() {
    if (pending.status !== 'review') return;
    const finalized: PendingPhotoImport = {
      ...pending.pending,
      measurements: editingMeasurements,
      labResults: editingLabs,
    };
    const ok = onCommitPhoto(finalized);
    if (ok) resetSelection();
  }

  function handleReEdit() {
    resetSelection();
    choosePhoto();
  }

  function handleCancel() {
    resetSelection();
  }

  const parserNote =
    imageParserMode === 'real-http'
      ? '当前走真实视觉识别（通过服务端代理）。识别结果仍需要您确认后才进入健康档案。'
      : '当前走演示数据 fallback（未配置 VITE_HEALTH_VISION_ENDPOINT）。示例数据仍需要您确认后才进入健康档案。';

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

      <ChatView id="elder-chat" chat={chat} onSend={onSend} quickInputs={quickInputs} />

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
            <span className="muted">{parserNote}</span>
          </div>
        </div>

        {pending.status === 'review' ? (
          <PhotoReviewPanel
            pending={pending.pending}
            fileName={pending.fileName}
            measurements={editingMeasurements}
            labs={editingLabs}
            onUpdateMeasurement={updateMeasurement}
            onUpdateLab={updateLab}
            onConfirm={handleConfirm}
            onReEdit={handleReEdit}
            onCancel={handleCancel}
          />
        ) : (
          <div className="chat-input-row">
            <select
              aria-label="要记录什么"
              value={photoKind}
              onChange={(event) => setPhotoKind(event.target.value as DemoImageKind)}
              disabled={pending.status === 'parsing'}
            >
              <option value="bloodPressure">{KIND_LABEL.bloodPressure}</option>
              <option value="weight">{KIND_LABEL.weight}</option>
              <option value="report">{KIND_LABEL.report}</option>
            </select>
            <button className="btn-primary" onClick={choosePhoto} disabled={pending.status === 'parsing'}>
              {pending.status === 'parsing' ? '识别中…' : '拍一张/选一张'}
            </button>
            <input
              ref={fileInputRef}
              hidden
              type="file"
              accept="image/*"
              onChange={(event) => void handlePhotoChange(event.target.files?.[0])}
            />
          </div>
        )}
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
    </div>
  );
}

interface PhotoReviewPanelProps {
  pending: PendingPhotoImport;
  fileName: string;
  measurements: HealthMeasurement[];
  labs: LabResult[];
  onUpdateMeasurement: (index: number, patch: Partial<HealthMeasurement>) => void;
  onUpdateLab: (index: number, patch: Partial<LabResult>) => void;
  onConfirm: () => void;
  onReEdit: () => void;
  onCancel: () => void;
}

function PhotoReviewPanel({
  pending,
  fileName,
  measurements,
  labs,
  onUpdateMeasurement,
  onUpdateLab,
  onConfirm,
  onReEdit,
  onCancel,
}: PhotoReviewPanelProps) {
  const isBloodPressure = measurements.some((m) => m.metric === 'systolic' || m.metric === 'diastolic');
  const sys = measurements.find((m) => m.metric === 'systolic')?.value;
  const dia = measurements.find((m) => m.metric === 'diastolic')?.value;
  const hr = measurements.find((m) => m.metric === 'restingHr')?.value;
  const weight = measurements.find((m) => m.metric === 'weight')?.value;
  const hasContent = measurements.length > 0 || labs.length > 0;

  const lowConfidence = pending.overallConfidence < 0.85;

  return (
    <div className="photo-review">
      <div className="muted">
        识别模式：<b>{pending.provider}</b> · 整体置信度 {(pending.overallConfidence * 100).toFixed(0)}%
      </div>
      <h3>请确认识别结果</h3>
      {!hasContent && (
        <p className="muted">这次没有从图片里读到任何数值，请换一张更清楚的图。</p>
      )}
      {isBloodPressure && sys !== undefined && dia !== undefined && (
        <div className="review-summary">
            <span className="muted">{DETECTED_LABEL.bloodPressure}</span>
            <div className="review-value">
              {sys} / {dia} <span className="muted">mmHg</span>
              {hr !== undefined && (
                <span className="muted">
                  {' '}
                  · 心率 {hr} bpm
                </span>
              )}
            </div>
          </div>
      )}
      {weight !== undefined && (
        <div className="review-summary">
          <span className="muted">{DETECTED_LABEL.weight}</span>
          <div className="review-value">{weight} kg</div>
        </div>
      )}
      {labs.length > 0 && (
        <div className="review-summary">
          <span className="muted">{DETECTED_LABEL.report}</span>
          <ul className="review-lab-list">
            {labs.map((l) => (
              <li key={l.id}>
                {l.name} {l.value} {l.unit}
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="review-edit">
        <summary>手动修改识别结果</summary>
        {measurements.map((m, i) => (
          <div className="review-edit-row" key={m.id}>
            <label>{METRICS[m.metric].label}</label>
            <input
              type="number"
              step="any"
              value={m.value}
              onChange={(e) => onUpdateMeasurement(i, { value: Number(e.target.value) })}
            />
            <input
              type="text"
              value={m.unit}
              onChange={(e) => onUpdateMeasurement(i, { unit: e.target.value })}
              aria-label="单位"
            />
          </div>
        ))}
        {labs.map((l, i) => (
          <div className="review-edit-row" key={l.id}>
            <label>{l.name}</label>
            <input
              type="number"
              step="any"
              value={l.value}
              onChange={(e) => onUpdateLab(i, { value: Number(e.target.value) })}
            />
            <input
              type="text"
              value={l.unit}
              onChange={(e) => onUpdateLab(i, { unit: e.target.value })}
              aria-label="单位"
            />
          </div>
        ))}
      </details>

      {pending.warnings.length > 0 && (
        <ul className="review-warnings">
          {pending.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <div className="review-meta muted">
        拍摄时间 {pending.capturedAt.replace('T', ' ').slice(0, 16)} · 文件 {fileName}
        {pending.rawText && pending.rawText.length < 200 && (
          <details>
            <summary>查看原始文本</summary>
            <pre>{pending.rawText}</pre>
          </details>
        )}
      </div>

      <div className="review-actions">
        <button className="btn-primary" onClick={onConfirm} disabled={!hasContent}>
          确认保存
        </button>
        <button className="btn-secondary" onClick={onReEdit}>
          重新识别
        </button>
        <button className="btn-secondary" onClick={onCancel}>
          取消
        </button>
        {lowConfidence && (
          <span className="muted review-low-conf">整体置信度偏低，请仔细核对。</span>
        )}
      </div>
    </div>
  );
}