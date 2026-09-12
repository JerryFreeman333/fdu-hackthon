import { useState } from 'react';
import type { DayRecord, ElderProfile, Finding, MetricKey, Observation } from '../types';
import { METRICS } from '../types';
import { computeBaseline, recentMean, diffDays } from '../engine/baseline';
import { severityBadge } from '../engine/escalate';
import Sparkline from './Sparkline';
import ProfileForm from './ProfileForm';
import type { DataMode } from '../store/profileStore';

interface ProfileViewProps {
  records: DayRecord[];
  observations: Observation[];
  findings: Finding[];
  today: string;
  /** 本机档案；传入后显示"我的档案"卡与编辑入口（评审 P0-4）。 */
  profile?: ElderProfile;
  dataMode?: DataMode;
  onProfileSave?: (profile: ElderProfile) => void;
  /** 评审 P0-4：清空本机全部数据入口；不传则不渲染该区块。 */
  onClearData?: () => void;
}

const DISPLAY_METRICS: MetricKey[] = [
  'steps',
  'walkSpeed',
  'restingHr',
  'nightWakes',
  'weight',
  'spo2',
  'systolic',
  'bloodGlucose',
];

export default function ProfileView({
  records,
  observations,
  findings,
  today,
  profile,
  dataMode = 'demo',
  onProfileSave,
  onClearData,
}: ProfileViewProps) {
  const profileFindings = findings.filter((f) => f.severity === 'alert' || f.severity === 'urgent');
  const [editingProfile, setEditingProfile] = useState(false);

  return (
    <div className="profile-view detail-view">
      {profile && onProfileSave ? (
        editingProfile ? (
          <div className="card">
            <h3>编辑我的档案</h3>
            <ProfileForm
              initial={profile}
              submitLabel="保存档案"
              onSubmit={(next) => {
                onProfileSave(next);
                setEditingProfile(false);
              }}
              onCancel={() => setEditingProfile(false)}
            />
          </div>
        ) : (
          <div className="card">
            <div className="section-head">
              <div>
                <h3>我的档案</h3>
                <span className="muted">
                  {dataMode === 'demo' ? '这是预置的演示档案，可以编辑体验建档功能。' : '随时可以修改，立即生效。'}
                </span>
              </div>
              <button className="btn-secondary" onClick={() => setEditingProfile(true)}>
                编辑我的档案
              </button>
            </div>
            <ul className="profile-summary">
              <li>
                <b>称呼</b>：{profile.name}
                {profile.age > 0 ? ` · ${profile.age} 岁` : ''}
              </li>
              <li>
                <b>用药</b>：{profile.medications.length > 0 ? profile.medications.join('；') : '（未填写）'}
              </li>
              <li>
                <b>家属</b>：
                {profile.familyPhone ? `${profile.familyContact || '已留电话'} ${profile.familyPhone}` : '（未填写）'}
              </li>
              <li>
                <b>社区医生</b>：{profile.communityDoctorPhone ?? '（未填写）'}
              </li>
            </ul>
          </div>
        )
      ) : (
        <div className="card">
          <div className="eyebrow">个人状态</div>
          <h3>这些信息用于认识老人，不是医疗诊断。</h3>
          <p className="muted">系统重点关注活动、行动能力、睡眠和近期主诉是否偏离本人平时状态。</p>
        </div>
      )}

      {profileFindings.length > 0 && (
        <div className="card highlight-card">
          <h3>值得留意的变化</h3>
          {profileFindings.map((finding) => {
            const badge = severityBadge(finding.severity);
            return (
              <div key={finding.id} className="finding">
                <div className="finding-head">
                  <span className={`badge ${badge.className}`}>{badge.text}</span>
                  <b>{finding.title}</b>
                </div>
                <p>{finding.detail}</p>
                <ul className="evidence">
                  {finding.evidence.slice(0, 3).map((evidence, i) => (
                    <li key={i}>{evidence}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <div className="card">
        <h3>个人变化趋势</h3>
        <div className="metric-grid">
          {DISPLAY_METRICS.map((key) => {
            const meta = METRICS[key];
            const values = records.map((record) => record.metrics[key] ?? null);
            const baseline = computeBaseline(records, key, { endDate: today, excludeDays: 3 });
            const recent = recentMean(records, key, today, 3);
            let deltaText: string | null = null;
            if (baseline && recent !== null && Math.abs(baseline.mean) > 1e-9) {
              const delta = (recent - baseline.mean) / Math.abs(baseline.mean);
              if (Math.abs(delta) >= 0.05)
                deltaText = `最近3天比平时${delta > 0 ? '高' : '低'} ${Math.abs(Math.round(delta * 100))}%`;
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
        <h3>近期记录</h3>
        <ul className="timeline">
          {[...observations]
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 10)
            .map((observation) => (
              <li key={observation.id}>
                <span className={`tl-src tl-${observation.source}`}>
                  {observation.source === 'chat'
                    ? '聊天'
                    : observation.source === 'photo'
                      ? '拍照数据'
                      : observation.source === 'device'
                        ? '设备'
                        : '记录'}
                </span>
                <span className="tl-date">{observation.date}</span>
                <span className="tl-text">{observation.text}</span>
              </li>
            ))}
        </ul>
        <p className="muted">
          最近 7 天记录数：
          {
            observations.filter(
              (observation) => diffDays(observation.date, today) >= 0 && diffDays(observation.date, today) < 7,
            ).length
          }
        </p>
      </div>

      {onClearData && (
        <div className="card data-reset-card">
          <h3>数据与隐私</h3>
          <p className="muted">
            全部数据只存在这台浏览器里，不会上传。清空会删除聊天、健康记录和所有设置，并回到初始选择，删除后无法恢复。
          </p>
          <button className="btn-secondary" onClick={onClearData}>
            清空本机全部数据
          </button>
        </div>
      )}
    </div>
  );
}
