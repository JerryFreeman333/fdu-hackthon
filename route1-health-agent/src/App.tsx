import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, ElderProfile, FamilyHealthEvent, UserRole } from './types';
import type { HomeSafetyAction } from './adapters/HomeSafetyActionAdapter';
import { METRICS } from './types';
import { TODAY, profile, records as seedRecords, seedChat, seedObservations, seedPhotoObservations } from './data/demo';
import { demoHomeSafetyActions } from './data/demoHomeSafetyActions';
import {
  legacySnapshotToEvents,
  materializeHealthData,
  measurementToEvent,
  mergeHealthEvents,
  type HealthEvent,
} from './pipeline/events';
import { measurementsToDayRecords } from './data/normalize';
import { demoDeviceAdapter } from './adapters/DemoDeviceAdapter';
import { runDetection } from './engine/detect';
import { buildAgentContext } from './engine/context';
import { collectFamilyNotifications } from './engine/escalate';
import { visibleFamilyEvents } from './engine/familyLedger';
import { healthRecordStore } from './store/LocalHealthRecordStore';
import { useNotificationDispatch } from './hooks/useNotificationDispatch';
import { pushPermission, requestPushPermission } from './adapters/BrowserNotificationChannel';
import { useCrossDeviceSync } from './hooks/useCrossDeviceSync';
import type { CrossTabMessageEnvelope } from './hooks/useCrossTabSync';
import ElderHome from './components/ElderHome';
import FamilyDashboard from './components/FamilyDashboard';
import ProfileView from './components/ProfileView';
import RoleGate from './components/RoleGate';
import FontSizeControl from './components/FontSizeControl';
import { useCareTasks } from './hooks/useCareTasks';
import { useElderChat } from './hooks/useElderChat';
import { useFamilyBinding } from './hooks/useFamilyBinding';
import { useFontScale } from './hooks/useFontScale';

const LEGACY_HEALTH_STORAGE_KEYS = ['ankang-route1-health-records-v1', 'ankang-route1-health-records-v2'];
const LEGACY_HOME_ACTION_KEY = 'ankang-route1-home-safety-actions-v1';

function clearLegacyHealthStorage() {
  if (typeof window === 'undefined') return;
  for (const key of LEGACY_HEALTH_STORAGE_KEYS) window.localStorage.removeItem(key);
}

function clearLegacyHomeSafetyStorage() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(LEGACY_HOME_ACTION_KEY);
}

function initialSnapshot(): { events: HealthEvent[]; familyEvents: FamilyHealthEvent[]; chat: ChatMessage[] } {
  clearLegacyHealthStorage();
  const stored = healthRecordStore.load();
  if (stored.events.length || stored.familyEvents.length || stored.chat.length) return stored;
  const events = legacySnapshotToEvents({
    records: seedRecords,
    observations: [...seedObservations, ...seedPhotoObservations],
    measurements: [],
    labResults: [],
  });
  const snapshot = { events, familyEvents: [], chat: seedChat };
  healthRecordStore.save(snapshot);
  return snapshot;
}

function initialHomeSafetyActions(): HomeSafetyAction[] {
  clearLegacyHomeSafetyStorage();
  return demoHomeSafetyActions.map((action) => ({ ...action }));
}

export default function App() {
  const initial = useMemo(() => initialSnapshot(), []);
  const [events, setEvents] = useState<HealthEvent[]>(initial.events);
  const [familyEvents, setFamilyEvents] = useState<FamilyHealthEvent[]>(initial.familyEvents);
  const [chat, setChat] = useState<ChatMessage[]>(initial.chat);
  const [homeSafetyActions, setHomeSafetyActions] = useState<HomeSafetyAction[]>(initialHomeSafetyActions);
  const [role, setRole] = useState<UserRole | null>(null);
  const [familyView, setFamilyView] = useState<'home' | 'detail' | 'report'>('home');
  const [toast, setToast] = useState<string | null>(null);
  const promptedFamilyFindingIdsRef = useRef(new Set<string>());
  const { fontScale, setFontScale } = useFontScale();
  const showToast = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const {
    familySharing,
    familyLink,
    sharedFindingIds,
    sharedFamilyEventIds,
    promptFamilyShare,
    requestFamilyShare,
    keepFamilyPrivate,
    revokeFamilyShare,
    generateInvite,
    bindFamily,
    shareFindingIds,
    shareFamilyEventIds,
  } = useFamilyBinding({ showToast });

  const activeProfile: ElderProfile = useMemo(() => ({ ...profile, familySharing }), [familySharing]);
  const healthData = useMemo(() => materializeHealthData(events), [events]);
  const { records, observations, measurements } = healthData;
  const familyRecords = useMemo(
    () => measurementsToDayRecords(measurements.filter((measurement) => measurement.visibility !== 'private')),
    [measurements],
  );
  const visibleFamilyFacts = useMemo(
    () => visibleFamilyEvents(familyEvents, familySharing, sharedFamilyEventIds),
    [familyEvents, familySharing, sharedFamilyEventIds],
  );
  const findings = useMemo(() => runDetection(events, TODAY), [events]);
  const agentContext = useMemo(
    () => buildAgentContext(activeProfile, events, TODAY, findings),
    [activeProfile, events, findings],
  );
  const familyNotifs = useMemo(
    () => collectFamilyNotifications(findings, familySharing, sharedFindingIds, TODAY),
    [findings, familySharing, sharedFindingIds],
  );
  // 今日信号量：主诉 / 聊天 / 设备 / 拍照 任一来源今天有事件就算一条。
  // 这条计数是 dashboardStatus 区分"今日真的没事"和"今日还没说话"的关键输入。
  const todaySignalCount = useMemo(
    () => events.filter((event) => typeof event.timestamp === 'string' && event.timestamp.startsWith(TODAY)).length,
    [events],
  );
  // 派发引擎只关心"是否真的送出去了"，UI 列表继续走 familyNotifs；
  // 二者共享 collectFamilyNotifications 的判定，但派发有台账和确认闭环。
  // 跨设备协同：仅当家里某个角色端存在可用邀请码时才打开 PeerJS；
  // 角色端未选择或邀请码还没生成时退化为仅同浏览器 tab 协同。
  const sync = useCrossDeviceSync({
    role,
    peerId: familyLink?.inviteCode ?? null,
    endpoint: role === 'elder' ? 'host' : role === 'family' ? 'guest' : 'none',
  });
  const {
    records: dispatchRecords,
    acknowledge: acknowledgeDispatch,
    mergeRecord,
    mergeAcknowledge,
  } = useNotificationDispatch({
    findings,
    familySharing,
    familyLink,
  });

  // 把本地派发台账的变更广播给其它 tab，让"老人端"和"家属端"在同一浏览器内
  // 互相能看到对方的动作。这是真跨设备同步上线前最诚实的演示形态：
  // 至少不是切同一个 useState。
  useEffect(() => {
    const unsubscribe = sync.subscribe((envelope: CrossTabMessageEnvelope) => {
      if (envelope.type === 'dispatch.acknowledge') {
        const payload = envelope.payload as { findingId: string };
        mergeAcknowledge(payload.findingId);
      } else if (envelope.type === 'dispatch.append') {
        const record = envelope.payload as import('./engine/notify').FamilyNotificationRecord;
        mergeRecord(record);
      }
    });
    return unsubscribe;
  }, [sync, mergeAcknowledge, mergeRecord]);

  // 本地确认时也广播一份，让另一个 tab 能即时反映出来。
  const handleAcknowledge = useCallback(
    (findingId: string) => {
      acknowledgeDispatch(findingId);
      sync.broadcast('dispatch.acknowledge', { findingId });
    },
    [acknowledgeDispatch, sync],
  );

  // 把本地新派发的台账广播给其它 tab：另一 tab 的 findings 签名未变，
  // 不会重跑派发引擎，所以不会重复触发系统通知，只接收并合并台账。
  const lastBroadcastRecordIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentIds = new Set(dispatchRecords.map((record) => record.findingId));
    for (const record of dispatchRecords) {
      if (!lastBroadcastRecordIdsRef.current.has(record.findingId)) {
        sync.broadcast('dispatch.append', record);
      }
    }
    lastBroadcastRecordIdsRef.current = currentIds;
  }, [dispatchRecords, sync]);
  const { tasks, updateStatus, ensureMedicationCheck } = useCareTasks({ findings });
  const {
    handleElderSend,
    handlePhotoImport,
    commitPhotoImport,
    cancelPhotoImport,
    pendingPhoto,
    pendingPhotoKind,
    pendingPhotoError,
    quickInputs,
  } = useElderChat({
    familySharing,
    events,
    chat,
    findings,
    agentContext,
    setEvents,
    setFamilyEvents,
    setChat,
    showToast,
    onMedicationMissed: () => ensureMedicationCheck(profile.medications),
    onShareFindingIds: shareFindingIds,
    onShareFamilyEventIds: shareFamilyEventIds,
  });

  useEffect(() => {
    let cancelled = false;
    const from = seedRecords[0]?.date ?? TODAY;
    demoDeviceAdapter.getMeasurements(profile.name, from, TODAY).then((deviceMeasurements) => {
      if (cancelled) return;
      setEvents((current) => mergeHealthEvents(current, deviceMeasurements.map(measurementToEvent)));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // 开应用就生成今天的"💊 今天的药"任务；老人不用等 chat 触发。
    ensureMedicationCheck(profile.medications);
  }, [profile.medications, ensureMedicationCheck]);

  useEffect(() => {
    healthRecordStore.save({ events, familyEvents, chat: chat.filter((item) => item.persisted !== false) });
  }, [events, familyEvents, chat]);

  useEffect(() => {
    if (familySharing !== 'denied') return;
    const newFamilyRelevantFindings = findings.filter(
      (finding) =>
        finding.familyEligible === true &&
        (finding.severity === 'alert' || finding.severity === 'urgent') &&
        !promptedFamilyFindingIdsRef.current.has(finding.id),
    );
    if (newFamilyRelevantFindings.length === 0) return;
    for (const finding of newFamilyRelevantFindings) promptedFamilyFindingIdsRef.current.add(finding.id);
    promptFamilyShare();
  }, [familySharing, findings, promptFamilyShare]);

  function selectRole(nextRole: UserRole) {
    setRole(nextRole);
  }

  // 家属首次进入 dashboard 时主动请求系统通知权限，
  // 这一刀是“行动闭环”离开页面的入口；用户拒接也能继续用，仅送达状态会标记为 unavailable。
  useEffect(() => {
    if (role !== 'family') return;
    if (pushPermission() !== 'default') return;
    void requestPushPermission();
  }, [role]);

  function resetRole() {
    setRole(null);
  }

  function handleTaskStatus(taskId: string, status: Parameters<typeof updateStatus>[1]) {
    updateStatus(taskId, status);
    if (status === 'completed') showToast('已完成。我会把这次处理结果记下来。');
  }

  function handleHomeSafetyActionStatus(actionId: string, status: HomeSafetyAction['status']) {
    setHomeSafetyActions((current) =>
      current.map((action) => (action.id === actionId ? { ...action, status } : action)),
    );
    if (status === 'done') showToast('已记录处理完成；重新扫描后才会确认风险是否消失。');
  }

  function contactElder() {
    showToast(`正在拨打：${activeProfile.familyContact}`);
    if (activeProfile.familyPhone) window.location.href = `tel:${activeProfile.familyPhone}`;
  }

  function contactDoctor() {
    const phone = activeProfile.communityDoctorPhone;
    if (!phone) {
      showToast('尚未配置社区医生电话。');
      return;
    }
    showToast(`正在拨打社区医生：${phone}`);
    window.location.href = `tel:${phone}`;
  }

  if (!role) return <RoleGate onSelect={selectRole} />;

  if (role === 'elder') {
    return (
      <div className="app">
        <header className="simple-header">
          <div>
            <div className="persona-name">{activeProfile.name}</div>
            <div className="persona-sub">
              今天 ·{' '}
              {activeProfile.familySharing === 'granted'
                ? '已允许必要的家属协同'
                : activeProfile.familySharing === 'ask'
                  ? '需要时先问您'
                  : '暂不共享给家属'}
            </div>
          </div>
          <div className="header-actions">
            <FontSizeControl value={fontScale} onChange={setFontScale} />
            <button className="btn-secondary" onClick={resetRole}>
              切换身份
            </button>
          </div>
        </header>
        <main className="content">
          <ElderHome
            profile={activeProfile}
            chat={chat}
            onSend={handleElderSend}
            onPhotoImport={handlePhotoImport}
            onCommitPhoto={commitPhotoImport}
            onCancelPhoto={cancelPhotoImport}
            pendingPhoto={pendingPhoto}
            pendingPhotoKind={pendingPhotoKind}
            pendingPhotoError={pendingPhotoError}
            quickInputs={quickInputs}
            tasks={tasks}
            findings={findings}
            familyLink={familyLink}
            onTaskStatus={handleTaskStatus}
            onRequestFamilyShare={requestFamilyShare}
            onKeepFamilyPrivate={keepFamilyPrivate}
            onRevokeFamilyShare={revokeFamilyShare}
            onGenerateInvite={generateInvite}
            syncStatus={sync.status}
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
            {familyLink?.status === 'active'
              ? `绑定关系：${familyLink.relation} ${familyLink.displayName}`
              : '尚未绑定老人'}
          </div>
        </div>
        <div className="header-actions">
          <FontSizeControl value={fontScale} onChange={setFontScale} />
          <button className="btn-secondary" onClick={resetRole}>
            切换身份
          </button>
        </div>
      </header>
      <main className="content">
        <FamilyDashboard
          profile={activeProfile}
          familyLink={familyLink}
          notifications={familyNotifs}
          dispatchRecords={dispatchRecords}
          onAcknowledgeDispatch={handleAcknowledge}
          findings={findings}
          familyEvents={visibleFamilyFacts}
          tasks={tasks}
          homeSafetyActions={homeSafetyActions}
          records={familyRecords}
          today={TODAY}
          onTaskStatus={handleTaskStatus}
          onHomeSafetyActionStatus={handleHomeSafetyActionStatus}
          onContactElder={contactElder}
          onContactDoctor={contactDoctor}
          onRevokeSharing={revokeFamilyShare}
          onBindFamily={bindFamily}
          onViewChange={setFamilyView}
          view={familyView}
          syncStatus={sync.status}
          tabId={sync.tabId}
          todaySignalCount={todaySignalCount}
        />
      </main>
      {toast && <div className="toast">{toast}</div>}
      <footer className="footer">
        第一阶段 MVP：先认识老人。硬件通过 Adapter 预留；拍照入口当前使用明确标注的 Demo parser，不读取真实图片内容；LLM
        可通过服务端 Endpoint 接入，浏览器端不保存厂商 API key。
      </footer>
    </div>
  );
}

export { METRICS };
