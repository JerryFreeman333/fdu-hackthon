import { useEffect, useMemo, useState } from 'react';
import type { CareTask, ChatMessage, ElderProfile, FamilyLink, HealthMeasurement, Observation, UserRole } from './types';
import { METRICS } from './types';
import { TODAY, profile, records as seedRecords, seedChat, seedObservations, seedPhotoObservations } from './data/demo';
import { appendHealthEvents, legacySnapshotToEvents, materializeHealthData, measurementToEvent, observationToEvent, mergeHealthEvents, type HealthEvent } from './pipeline/events';
import { demoDeviceAdapter } from './adapters/DemoDeviceAdapter';
import { runDetection } from './engine/detect';
import { buildAgentContext } from './engine/context';
import { collectFamilyNotifications } from './engine/escalate';
import { createHttpLlmAdapter, generateAgentReply, msg, parseElderInput, QUICK_INPUTS, ruleBasedAdapter, tagLabel } from './engine/agent';
import { extractHealthValues } from './engine/extract';
import { canShareWithFamily, parsePrivacyIntent } from './engine/privacy';
import { buildInitialTasks, createTaskFromFinding, updateTaskStatus } from './engine/tasks';
import { healthRecordStore } from './store/LocalHealthRecordStore';
import ElderHome from './components/ElderHome';
import FamilyDashboard from './components/FamilyDashboard';
import ProfileView from './components/ProfileView';
import RoleGate from './components/RoleGate';

const ROLE_KEY = 'ankang-route1-role-v3';
const TASK_KEY = 'ankang-route1-tasks-v2';
const CONSENT_KEY = 'ankang-route1-consent-v1';
const FAMILY_LINK_KEY = 'ankang-route1-family-link-v1';
const INVITE_PREFIX = 'ankang-route1-invite:';
const llmAdapter = import.meta.env.VITE_AGENT_LLM_ENDPOINT
  ? createHttpLlmAdapter(import.meta.env.VITE_AGENT_LLM_ENDPOINT)
  : ruleBasedAdapter;

type FamilyView = 'home' | 'detail' | 'report';
type StoredTask = CareTask;

function initialSnapshot() {
  const stored = healthRecordStore.load();
  if (stored.events.length || stored.chat.length) return stored;
  const events = legacySnapshotToEvents({
    records: seedRecords,
    observations: [...seedObservations, ...seedPhotoObservations],
    measurements: [],
    labResults: [],
  });
  const snapshot = { events, chat: seedChat };
  healthRecordStore.save(snapshot);
  return snapshot;
}

function loadTasks(): CareTask[] {
  try {
    const raw = window.localStorage.getItem(TASK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredTask[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // use an empty task list rather than inventing daily work
  }
  return buildInitialTasks(TODAY);
}

function loadFamilySharing(): ElderProfile['familySharing'] {
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY);
    if (raw === 'granted' || raw === 'ask' || raw === 'denied') return raw;
  } catch {
    // fall back to the demo account's initial consent state
  }
  return profile.familySharing;
}

function loadFamilyLink(): FamilyLink | null {
  try {
    const raw = window.localStorage.getItem(FAMILY_LINK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FamilyLink;
    return parsed && typeof parsed.inviteCode === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function createInviteCode(): string {
  const random = typeof crypto !== 'undefined' && 'getRandomValues' in crypto
    ? crypto.getRandomValues(new Uint32Array(1))[0] % 10000
    : Math.floor(Math.random() * 10000);
  return `AN-${TODAY.slice(0, 4)}-${random.toString().padStart(4, '0')}`;
}

export default function App() {
  const initial = useMemo(() => initialSnapshot(), []);
  const [events, setEvents] = useState<HealthEvent[]>(initial.events);
  const [chat, setChat] = useState<ChatMessage[]>(initial.chat);
  const [role, setRole] = useState<UserRole | null>(() => {
    const saved = window.localStorage.getItem(ROLE_KEY);
    return saved === 'elder' || saved === 'family' ? saved : null;
  });
  const [familySharing, setFamilySharing] = useState<ElderProfile['familySharing']>(() => loadFamilySharing());
  const [familyLink, setFamilyLink] = useState<FamilyLink | null>(() => loadFamilyLink());
  const [familyView, setFamilyView] = useState<FamilyView>('home');
  const [toast, setToast] = useState<string | null>(null);
  const [tasks, setTasks] = useState<CareTask[]>(() => loadTasks());
  const activeProfile: ElderProfile = useMemo(() => ({ ...profile, familySharing }), [familySharing]);
  const healthData = useMemo(() => materializeHealthData(events), [events]);
  const { records, observations } = healthData;
  const findings = useMemo(() => runDetection(events, TODAY), [events]);
  const agentContext = useMemo(() => buildAgentContext(activeProfile, events, TODAY, findings), [activeProfile, events, findings]);
  const familyNotifs = useMemo(() => collectFamilyNotifications(findings, familySharing), [findings, familySharing]);

  useEffect(() => {
    let cancelled = false;
    const from = seedRecords[0]?.date ?? TODAY;
    demoDeviceAdapter.getMeasurements(profile.name, from, TODAY).then((deviceMeasurements) => {
      if (cancelled) return;
      setEvents((current) => mergeHealthEvents(current, deviceMeasurements.map(measurementToEvent)));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    healthRecordStore.save({ events, chat: chat.filter((item) => item.persisted !== false) });
    window.localStorage.setItem(TASK_KEY, JSON.stringify(tasks));
    window.localStorage.setItem(CONSENT_KEY, familySharing);
    if (familyLink) window.localStorage.setItem(FAMILY_LINK_KEY, JSON.stringify(familyLink));
    else window.localStorage.removeItem(FAMILY_LINK_KEY);
  }, [events, chat, tasks, familySharing, familyLink]);

  useEffect(() => {
    const actionable = findings.filter((finding) => finding.severity === 'alert' || finding.severity === 'urgent');
    if (actionable.length === 0) return;
    setTasks((current) => {
      const next = [...current];
      for (const finding of actionable.slice(0, 2)) {
        const task = createTaskFromFinding(finding, TODAY);
        if (task && !next.some((item) => item.id === task.id)) next.push(task);
      }
      return next;
    });
  }, [findings]);

  function showToast(text: string) {
    setToast(text);
    window.setTimeout(() => setToast(null), 3200);
  }

  function selectRole(nextRole: UserRole) {
    setRole(nextRole);
    window.localStorage.setItem(ROLE_KEY, nextRole);
  }

  function resetRole() {
    setRole(null);
    window.localStorage.removeItem(ROLE_KEY);
  }

  async function handleElderSend(text: string) {
    const intent = parsePrivacyIntent(text);
    if (intent === 'share_family' && familySharing !== 'denied') setFamilySharing('granted');

    const { tags } = parseElderInput(text);
    const extractedValues = extractHealthValues(text);
    const effectiveSharing = intent === 'share_family' ? 'granted' as const : familySharing;
    const canShare = canShareWithFamily(effectiveSharing, intent);
    const now = `${TODAY.slice(5)} ${new Date().toTimeString().slice(0, 5)}`;
    const persisted = intent !== 'no_record';
    const agentText = await generateAgentReply(text, tags, findings, tags.includes('fall'), agentContext, llmAdapter);
    setChat((current) => [...current, msg('elder', text, now, persisted), msg('agent', agentText, now, persisted)]);

    if (intent === 'no_record') {
      showToast('这段内容不会保存到健康记录或家属端。');
      return;
    }

    const incomingEvents: HealthEvent[] = [];
    if (tags.length > 0) {
      incomingEvents.push(observationToEvent({
        id: `obs-live-${Date.now()}`,
        date: TODAY,
        source: 'chat',
        text,
        tags,
        visibility: canShare ? 'family_ok' : 'private',
      }));
    }

    for (const extracted of extractedValues) {
      const measurement: HealthMeasurement = {
        id: `chat-value-${Date.now()}-${extracted.metric}`,
        timestamp: `${TODAY}T${new Date().toTimeString().slice(0, 8)}`,
        metric: extracted.metric,
        value: extracted.value,
        unit: extracted.unit,
        source: 'chat',
        confidence: 0.9,
        metadata: { sourceText: extracted.sourceText, extraction: 'rule' },
      };
      incomingEvents.push(measurementToEvent(measurement));
    }

    if (incomingEvents.length > 0) {
      setEvents((current) => appendHealthEvents(current, incomingEvents));
      const labels = tags.map(tagLabel);
      const values = extractedValues.map((item) => `${item.metric === 'nightWakes' ? '夜间醒来' : '活动步数'} ${item.value}${item.unit}`);
      showToast(`已记录：${[...labels, ...values].join('、')}${canShare ? '；按当前授权可供家属查看必要变化' : '；仅供您本人使用'}`);
    }

    if (tags.includes('medicationMissed')) {
      setTasks((current) => current.some((task) => task.kind === 'medication_check' && task.status === 'pending') ? current : [...current, {
        id: `task-medication-${TODAY}`,
        title: '确认今天是否按原来的医生方案服药',
        description: '不要自行加倍或调整药量，只确认并按原方案处理。',
        dueDate: TODAY,
        status: 'pending',
        createdAt: `${TODAY}T${new Date().toTimeString().slice(0, 8)}`,
        kind: 'medication_check',
      }]);
    }
    if (tags.includes('fall')) showToast('已标记为紧急事件，请先确认安全并保持电话畅通。');
  }

  function handleTaskStatus(taskId: string, status: CareTask['status']) {
    setTasks((current) => current.map((task) => task.id === taskId ? updateTaskStatus(task, status) : task));
    if (status === 'completed') showToast('已完成。我会把这次处理结果记下来。');
  }

  function requestFamilyShare() { setFamilySharing('granted'); showToast('已同意在必要时与家属共享。'); }
  function keepFamilyPrivate() { setFamilySharing('denied'); showToast('好的，先不告诉家属。之后需要时，您可以再打开共享。'); }
  function revokeFamilyShare() { setFamilySharing('denied'); showToast('已暂停家属共享。老人本人仍可继续使用助手。'); }
  function contactElder() { showToast(`演示联系：${activeProfile.familyContact}`); }

  function generateInvite() {
    const code = createInviteCode();
    const link: FamilyLink = {
      id: `family-${Date.now()}`,
      relation: '家属',
      displayName: '待绑定',
      maskedContact: '未绑定',
      inviteCode: code,
      status: 'pending',
    };
    window.localStorage.setItem(`${INVITE_PREFIX}${code}`, JSON.stringify({ elderId: `elder-${profile.name}`, relation: '家属' }));
    setFamilyLink(link);
    showToast(`邀请码已生成：${code}`);
  }

  function bindFamily(inviteCode: string): boolean {
    if (!inviteCode) return false;
    try {
      const raw = window.localStorage.getItem(`${INVITE_PREFIX}${inviteCode}`);
      if (!raw) return false;
      const invite = JSON.parse(raw) as { elderId?: string; relation?: string };
      if (invite.elderId !== `elder-${profile.name}`) return false;
      const link: FamilyLink = {
        id: `family-${Date.now()}`,
        relation: invite.relation ?? '家属',
        displayName: '本地演示家属',
        maskedContact: '本地设备',
        inviteCode,
        status: 'active',
      };
      setFamilyLink(link);
      showToast('家属绑定成功（本地 Demo）。');
      return true;
    } catch {
      return false;
    }
  }

  if (!role) return <RoleGate onSelect={selectRole} />;

  if (role === 'elder') {
    return (
      <div className="app">
        <header className="simple-header">
          <div>
            <div className="persona-name">{activeProfile.name}</div>
            <div className="persona-sub">
              今天 · {activeProfile.familySharing === 'granted' ? '已允许必要的家属协同' : activeProfile.familySharing === 'ask' ? '需要时先问您' : '暂不共享给家属'}
            </div>
          </div>
          <button className="btn-secondary" onClick={resetRole}>切换身份</button>
        </header>
        <main className="content">
          <ElderHome
            profile={activeProfile}
            chat={chat}
            onSend={handleElderSend}
            quickInputs={QUICK_INPUTS}
            tasks={tasks}
            findings={findings}
            familyLink={familyLink}
            onTaskStatus={handleTaskStatus}
            onRequestFamilyShare={requestFamilyShare}
            onKeepFamilyPrivate={keepFamilyPrivate}
            onGenerateInvite={generateInvite}
          />
          <details className="advanced-details">
            <summary>查看我的状态（可选）</summary>
            <ProfileView records={records} observations={observations} findings={findings} today={TODAY} />
          </details>
        </main>
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="simple-header">
        <div>
          <div className="persona-name">{activeProfile.name} · 家属端</div>
          <div className="persona-sub">
            {familyLink?.status === 'active' ? `绑定关系：${familyLink.relation} ${familyLink.displayName}` : '尚未绑定老人'}
          </div>
        </div>
        <button className="btn-secondary" onClick={resetRole}>切换身份</button>
      </header>
      <main className="content">
        <FamilyDashboard
          profile={activeProfile}
          familyLink={familyLink}
          notifications={familyNotifs}
          findings={findings}
          tasks={tasks}
          records={records}
          observations={observations}
          today={TODAY}
          onTaskStatus={handleTaskStatus}
          onContactElder={contactElder}
          onRevokeSharing={revokeFamilyShare}
          onBindFamily={bindFamily}
          onViewChange={setFamilyView}
          view={familyView}
        />
      </main>
      {toast && <div className="toast">{toast}</div>}
      <footer className="footer">
        第一阶段 MVP：先认识老人。当前硬件与 OCR 仍通过 Adapter/本地能力预留；LLM 默认本地规则，可通过服务端 Endpoint 接入真实模型。
      </footer>
    </div>
  );
}

export { METRICS };
