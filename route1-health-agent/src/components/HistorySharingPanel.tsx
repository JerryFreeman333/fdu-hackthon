import { useState } from 'react';
import type { HistoricalHealthEvent } from '../types';
import { SYMPTOM_LABELS } from '../types';
import {
  buildSharedHistoricalFacts,
  createHistoricalShareGrant,
  historyStatusLabel,
  isHistoricalShareGrantActive,
  type HistoricalShareGrant,
  type HistoricalShareScope,
} from '../engine/historySharing';

interface HistorySharingPanelProps {
  events: HistoricalHealthEvent[];
  grants: HistoricalShareGrant[];
  familyLinkId: string;
  knownNames: string[];
  today: string;
  onGrant: (eventId: string, scope: HistoricalShareScope, redactions: string[]) => void;
  onRevoke: (eventId: string) => void;
}

export default function HistorySharingPanel({
  events,
  grants,
  familyLinkId,
  knownNames,
  today,
  onGrant,
  onRevoke,
}: HistorySharingPanelProps) {
  const [selection, setSelection] = useState<{ eventId: string; scope: HistoricalShareScope } | null>(null);
  const [extraRedactions, setExtraRedactions] = useState('');
  if (events.length === 0) return null;

  return (
    <section className="card history-sharing-panel" aria-label="既往情况与家属授权">
      <span className="page-kicker">由您决定谁能看</span>
      <h2>既往情况 · 家属授权</h2>
      <p className="muted">过去的情况单独保存，不用于今天的安全判断。默认仅您可见，每次只分享一条。</p>
      <ul className="history-entry-list">
        {events.map((event) => {
          const grant = grants.find((item) => item.eventId === event.id && item.familyLinkId === familyLinkId);
          const activeGrant = grant && isHistoricalShareGrantActive(grant, today) ? grant : null;
          const editing = selection?.eventId === event.id;
          const redactions = extraRedactions.split(/[,，、;；\n]+/);
          const previewGrant = editing
            ? createHistoricalShareGrant(
                event.id,
                selection.scope,
                familyLinkId,
                today,
                new Date().toISOString(),
                redactions,
              )
            : null;
          const preview = previewGrant
            ? buildSharedHistoricalFacts([event], [previewGrant], familyLinkId, today, knownNames)[0]
            : undefined;
          const openPreview = (scope: HistoricalShareScope) => {
            setSelection({ eventId: event.id, scope });
            setExtraRedactions(grant?.redactions.join('，') ?? '');
          };
          return (
            <li key={event.id} className="history-entry">
              <div className="finding-head">
                <span className="badge badge-muted">既往</span>
                <span className="muted">{event.eventDate ?? '日期不详'}</span>
              </div>
              <p className="history-original">{event.text}</p>
              <p className="history-share-state">
                {activeGrant
                  ? `家属可见：${activeGrant.scope === 'summary_only' ? '仅摘要' : '含脱敏原话'} · 至 ${activeGrant.expiresAt}`
                  : familyLinkId
                    ? '家属目前看不到这一条'
                    : '先绑定家属后才能授权'}
              </p>
              <div className="history-share-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!familyLinkId}
                  onClick={() => openPreview('summary_only')}
                >
                  {activeGrant ? '仅摘要' : '允许查看摘要'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!familyLinkId}
                  onClick={() => openPreview('summary_with_text')}
                >
                  {activeGrant ? '含脱敏原话' : '允许查看脱敏原话'}
                </button>
                {activeGrant && (
                  <button
                    type="button"
                    className="btn-secondary history-revoke"
                    onClick={() => {
                      onRevoke(event.id);
                      setSelection(null);
                    }}
                  >
                    撤回
                  </button>
                )}
              </div>
              {editing && preview && (
                <div className="history-share-preview" role="group" aria-label="授权预览">
                  <h3>家属将看到的内容</h3>
                  <p>{preview.tags.map((tag) => SYMPTOM_LABELS[tag]).join('、') || '健康情况'}</p>
                  <p className="muted">
                    {preview.eventMonth ?? '日期不详'} · {historyStatusLabel(preview.status)} · 至 {preview.expiresAt}
                  </p>
                  {selection.scope === 'summary_with_text' ? (
                    <>
                      <p className="shared-history-text">{preview.text}</p>
                      <label className="history-redaction-label">
                        还要隐藏的姓名、地点（用逗号分隔）
                        <input
                          type="text"
                          value={extraRedactions}
                          maxLength={500}
                          onChange={(change) => setExtraRedactions(change.target.value)}
                        />
                      </label>
                      <p className="muted">请核对预览。自动遮蔽可能漏掉陌生姓名；在上方补充后，预览会同步更新。</p>
                    </>
                  ) : (
                    <p className="muted">只分享月份、症状和状态，不分享原话。</p>
                  )}
                  <p className="muted">有效期含今天共 7 天；这条授权独立于日常健康共享，可随时撤回。</p>
                  <div className="history-share-actions">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => {
                        onGrant(event.id, selection.scope, redactions);
                        setSelection(null);
                      }}
                    >
                      确认授权，7 天有效
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => setSelection(null)}>
                      取消
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
