import { useMemo, useState } from 'react';
import type { ChatMessage, DayRecord, MetricKey, Observation } from './types';
import { METRICS } from './types';
import { TODAY, profile, records as seedRecords, seedChat, seedObservations, seedPhotoObservations } from './data/demo';
import { runDetection } from './engine/detect';
import { collectFamilyNotifications } from './engine/escalate';
import { generateAgentReply, msg, parseElderInput, QUICK_INPUTS, tagLabel } from './engine/agent';
import ChatView from './components/ChatView';
import ProfileView from './components/ProfileView';
import ReportView from './components/ReportView';
import FamilyView from './components/FamilyView';

type Tab = 'chat' | 'profile' | 'report' | 'family';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'chat', label: '和阿安聊天' },
  { key: 'profile', label: '健康档案' },
  { key: 'report', label: '每周周报' },
  { key: 'family', label: '家属通知' },
];

/** 模拟 OCR 可识别的样张 */
const PHOTO_SAMPLES: Array<{
  label: string;
  metrics: Partial<Record<MetricKey, number>>;
  obsText: string;
  tags: Observation['tags'];
}> = [
  { label: '📷 拍血压计', metrics: { systolic: 148, diastolic: 88 }, obsText: '拍照录入：血压 148/88 mmHg', tags: ['bpHigh'] },
  { label: '📷 拍体重秤', metrics: { weight: 63.8 }, obsText: '拍照录入：体重 63.8 kg', tags: [] },
  { label: '📷 拍血糖仪', metrics: {}, obsText: '拍照录入：空腹血糖 6.1 mmol/L', tags: [] },
  { label: '📷 拍体检报告', metrics: {}, obsText: '拍照录入：体检报告（NT-proBNP 320 pg/ml，偏高）', tags: [] },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('chat');
  const [records, setRecords] = useState<DayRecord[]>(seedRecords);
  const [observations, setObservations] = useState<Observation[]>([...seedObservations, ...seedPhotoObservations]);
  const [chat, setChat] = useState<ChatMessage[]>(seedChat);
  const [toast, setToast] = useState<string | null>(null);

  // 每次数据/主诉变化都重新跑一遍检测
  const findings = useMemo(() => runDetection(records, observations, TODAY), [records, observations]);
  const familyNotifs = useMemo(() => collectFamilyNotifications(findings), [findings]);

  function showToast(text: string) {
    setToast(text);
    window.setTimeout(() => setToast(null), 3200);
  }

  function handleElderSend(text: string) {
    const { tags } = parseElderInput(text);
    const now = `09-06 ${new Date().toTimeString().slice(0, 5)}`;
    const elderMsg = msg('elder', text, now);
    const reply = generateAgentReply(text, tags, findings, tags.includes('fall'));
    const agentMsg = msg('agent', reply, now);

    setChat((c) => [...c, elderMsg, agentMsg]);
    if (tags.length > 0) {
      setObservations((o) => [...o, { id: `obs-live-${Date.now()}`, date: TODAY, source: 'chat', text, tags }]);
      showToast(`已记录：${tags.map(tagLabel).join('、')} —— 会结合数据持续观察`);
    }
    if (tags.includes('fall')) {
      showToast('🚨 已立即通知家属！');
    }
  }

  function handlePhoto(sampleIndex: number) {
    const sample = PHOTO_SAMPLES[sampleIndex];
    if (Object.keys(sample.metrics).length > 0) {
      setRecords((rs) =>
        rs.map((r) => (r.date === TODAY ? { ...r, metrics: { ...r.metrics, ...sample.metrics } } : r)),
      );
    }
    setObservations((o) => [
      ...o,
      { id: `photo-live-${Date.now()}`, date: TODAY, source: 'photo', text: sample.obsText, tags: sample.tags },
    ]);
    showToast(`已识别并录入：${sample.obsText.replace('拍照录入：', '')}`);
  }

  const alertCount = familyNotifs.filter((n) => n.finding.severity === 'urgent').length;
  const watchCount = familyNotifs.length - alertCount;

  return (
    <div className="app">
      <header className="header">
        <div className="header-persona">
          <div className="avatar">{profile.name.slice(0, 1)}</div>
          <div>
            <div className="persona-name">
              {profile.name} · {profile.age}岁
            </div>
            <div className="persona-sub">
              {profile.conditions.join(' · ')} ｜ 紧急联系人：{profile.familyContact}
            </div>
          </div>
        </div>
        <div className="header-note">安康 Agent · 老年健康守护原型（模拟数据）</div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'tab-active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === 'family' && familyNotifs.length > 0 && (
              <span className="tab-badge">{alertCount > 0 ? alertCount : watchCount}</span>
            )}
          </button>
        ))}
      </nav>

      <main className="content">
        {tab === 'chat' && <ChatView chat={chat} onSend={handleElderSend} quickInputs={QUICK_INPUTS} />}
        {tab === 'profile' && (
          <ProfileView
            records={records}
            observations={observations}
            findings={findings}
            today={TODAY}
            onPhoto={handlePhoto}
            photoSamples={PHOTO_SAMPLES.map((s) => s.label)}
          />
        )}
        {tab === 'report' && <ReportView records={records} observations={observations} findings={findings} today={TODAY} />}
        {tab === 'family' && <FamilyView notifications={familyNotifs} findings={findings} />}
      </main>

      {toast && <div className="toast">{toast}</div>}

      <footer className="footer">
        原型说明：所有数据均为模拟数据 · Agent 只做"状态变化发现"，不做疾病诊断 · 平时不打扰家属，异常时才通知
      </footer>
    </div>
  );
}

/** 给档案页导出指标元信息 */
export { METRICS };
