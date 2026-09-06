import { useState } from 'react';
import type { DayRecord, Finding, MetricKey, Observation } from '../types';
import { METRICS } from '../types';
import { computeBaseline, recentMean, diffDays } from '../engine/baseline';
import { severityBadge } from '../engine/escalate';
import Sparkline from './Sparkline';

interface ProfileViewProps {
  records: DayRecord[];
  observations: Observation[];
  findings: Finding[];
  today: string;
  onPhoto: (sampleIndex: number) => void;
  photoSamples: string[];
}

const DISPLAY_METRICS: MetricKey[] = ['steps', 'walkSpeed', 'restingHr', 'nightWakes', 'weight', 'spo2', 'systolic'];

export default function ProfileView({ records, observations, findings, today, onPhoto, photoSamples }: ProfileViewProps) {
  const [ocrBusy, setOcrBusy] = useState<number | null>(null);

  function simulateOcr(i: number) {
    setOcrBusy(i);
    window.setTimeout(() => {
      setOcrBusy(null);
      onPhoto(i);
    }, 900);
  }

  const profileFindings = findings.filter((f) => f.severity === 'alert' || f.severity === 'urgent');

  return (
    <div className="profile-view">
      <div className="card photo-card">
        <h3>拍照录入（模拟 OCR）</h3>
        <p className="muted">不用手动输数字，对准设备拍一下就行。原型阶段用样张模拟识别：</p>
        <div className="photo-row">
          {photoSamples.map((label, i) => (
            <button key={label} className="chip chip-photo" disabled={ocrBusy !== null} onClick={() => simulateOcr(i)}>
              {ocrBusy === i ? '识别中…' : label}
            </button>
          ))}
        </div>
      </div>

      {profileFindings.length > 0 && (
        <div className="card highlight-card">
          <h3>结合数据后，值得留意的变化</h3>
          {profileFindings.map((f) => {
            const badge = severityBadge(f.severity);
            return (
              <div key={f.id} className="finding">
                <div className="finding-head">
                  <span className={`badge ${badge.className}`}>{badge.text}</span>
                  <b>{f.title}</b>
                </div>
                <p>{f.detail}</p>
                <ul className="evidence">
                  {f.evidence.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <div className="card">
        <h3>长期健康档案（近 21 天，虚线 = 您自己的基线，红色 = 最近 3 天）</h3>
        <div className="metric-grid">
          {DISPLAY_METRICS.map((key) => {
            const meta = METRICS[key];
            const values = records.map((r) => r.metrics[key] ?? null);
            const baseline = computeBaseline(records, key, { endDate: today, excludeDays: 3 });
            const rec = recentMean(records, key, today, 3);
            let deltaText: string | null = null;
            if (baseline && rec !== null) {
              const bad = meta.higherIsBad ? rec - baseline.mean : baseline.mean - rec;
              if (baseline.mean !== 0 && Math.abs(bad / baseline.mean) >= 0.05) {
                deltaText = `最近3天比平时${bad > 0 ? '高' : '低'} ${Math.abs(Math.round((bad / baseline.mean) * 100))}%`;
              }
            }
            return (
              <div key={key} className="metric-card">
                <div className="metric-title">
                  {meta.label}
                  {deltaText && <span className="metric-delta">{deltaText}</span>}
                </div>
                <Sparkline values={values} baseline={baseline?.mean} decimals={meta.decimals} />
                <div className="metric-unit">
                  单位：{meta.unit} · 基线约 {baseline ? baseline.mean.toFixed(meta.decimals) : '—'} {meta.unit}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h3>记录时间线（主诉 + 拍照录入）</h3>
        <ul className="timeline">
          {[...observations]
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 10)
            .map((o) => (
              <li key={o.id}>
                <span className={`tl-src tl-${o.source}`}>{o.source === 'chat' ? '聊天' : o.source === 'photo' ? '拍照' : '设备'}</span>
                <span className="tl-date">{o.date}</span>
                <span className="tl-text">{o.text}</span>
              </li>
            ))}
        </ul>
        <p className="muted">共 {observations.filter((o) => diffDays(o.date, today) >= 0 && diffDays(o.date, today) < 7).length} 条记录产生于最近 7 天</p>
      </div>
    </div>
  );
}
