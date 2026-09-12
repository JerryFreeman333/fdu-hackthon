import { useRef, useState, type ReactNode } from 'react';
import type { ParsedHealthData } from '../adapters/ImageHealthParser';
import type { DemoImageKind } from '../adapters/DemoImageHealthParser';
import type { DataMode } from '../store/profileStore';
import type { ElderProfile, Finding } from '../types';
import { METRICS } from '../types';

interface ElderHealthPageProps {
  profile: ElderProfile;
  findings: Finding[];
  dataMode: DataMode;
  onPhotoImport: (file: Blob, kind: DemoImageKind) => void | Promise<void>;
  onCommitPhoto: () => void;
  onCancelPhoto: () => void;
  pendingPhoto: ParsedHealthData | null;
  pendingPhotoKind: DemoImageKind | null;
  pendingPhotoError: string | null;
  children: ReactNode;
}

export default function ElderHealthPage({
  profile,
  findings,
  dataMode,
  onPhotoImport,
  onCommitPhoto,
  onCancelPhoto,
  pendingPhoto,
  pendingPhotoKind,
  pendingPhotoError,
  children,
}: ElderHealthPageProps) {
  const [photoKind, setPhotoKind] = useState<DemoImageKind>('bloodPressure');
  const inputRef = useRef<HTMLInputElement>(null);
  const urgentCount = findings.filter((finding) => finding.severity === 'urgent').length;
  const alertCount = findings.filter((finding) => finding.severity === 'alert').length;
  const status = urgentCount > 0 ? '需要立即处理' : alertCount > 0 ? '有变化值得留意' : '目前没有需要处理的变化';

  async function handleFile(file: File | undefined) {
    if (!file) return;
    await onPhotoImport(file, photoKind);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="health-page">
      <header className="page-title-block">
        <span className="page-kicker">我的健康</span>
        <h1>{profile.name}的状态</h1>
        <p>这里只说明变化和下一步，不用每天盯着一堆数字。</p>
      </header>

      <section
        className={`card health-status-card health-status-${urgentCount ? 'urgent' : alertCount ? 'alert' : 'calm'}`}
      >
        <span className="status-pulse" aria-hidden="true" />
        <div>
          <span>今日概况</span>
          <h2>{status}</h2>
          <p>
            {urgentCount > 0
              ? '请先按页面建议处理，必要时直接联系家属或急救。'
              : alertCount > 0
                ? '系统会说明变化来自哪里，并给出可以执行的下一步。'
                : '数据稳定时，系统会尽量保持安静。'}
          </p>
        </div>
      </section>

      <section className="card capture-card">
        <div className="section-head compact-section-head">
          <div>
            <span className="page-kicker">快速记录</span>
            <h2>拍下测量结果</h2>
          </div>
        </div>
        <p className="muted">
          {dataMode === 'demo'
            ? '当前为演示解析，结果会明确标记为示例；确认后才写入记录。'
            : import.meta.env.VITE_HEALTH_VISION_ENDPOINT?.trim()
              ? '识别结果会先让您确认，确认后才写入健康记录。'
              : '真实识别服务尚未配置。可以先保存原始附件，不会写入模拟识别结果。'}
        </p>
        <div className="capture-actions">
          <select
            aria-label="要记录什么"
            value={photoKind}
            onChange={(event) => setPhotoKind(event.target.value as DemoImageKind)}
          >
            <option value="bloodPressure">血压</option>
            <option value="weight">体重</option>
            <option value="report">体检报告</option>
          </select>
          <button className="btn-primary" type="button" onClick={() => inputRef.current?.click()}>
            拍照或选择图片
          </button>
          <input
            ref={inputRef}
            hidden
            type="file"
            accept="image/*"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
        </div>
      </section>

      {pendingPhotoError && (
        <section className="card photo-confirm-card photo-confirm-error">
          <p>{pendingPhotoError}</p>
          <button className="btn-secondary" onClick={onCancelPhoto}>
            知道了
          </button>
        </section>
      )}

      {pendingPhoto && (
        <section className="card photo-confirm-card">
          <span className="page-kicker">请确认</span>
          <h2>识别到这些内容，对吗？</h2>
          <p className="muted">
            {pendingPhotoKind === 'bloodPressure'
              ? '血压计照片'
              : pendingPhotoKind === 'weight'
                ? '体重秤照片'
                : '体检报告照片'}
          </p>
          <ul className="photo-confirm-list">
            {pendingPhoto.measurements.map((measurement) => {
              const meta = METRICS[measurement.metric];
              return (
                <li key={measurement.id}>
                  <b>{meta?.label ?? measurement.metric}</b>
                  <span>
                    {measurement.value.toFixed(meta?.decimals ?? 1)} {meta?.unit ?? measurement.unit}
                  </span>
                </li>
              );
            })}
            {pendingPhoto.labResults.map((lab) => (
              <li key={lab.id}>
                <b>{lab.name}</b>
                <span>
                  {lab.value} {lab.unit}
                </span>
              </li>
            ))}
          </ul>
          <div className="photo-confirm-actions">
            <button className="btn-primary" onClick={onCommitPhoto}>
              确认并记录
            </button>
            <button className="btn-secondary" onClick={onCancelPhoto}>
              重新选择
            </button>
          </div>
        </section>
      )}

      <details className="health-details">
        <summary>查看变化趋势和近期记录</summary>
        {children}
      </details>
    </div>
  );
}
