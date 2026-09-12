import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, ElderProfile, FamilyHealthEvent, UserRole } from './types';
import type { HomeSafetyAction } from './adapters/HomeSafetyActionAdapter';
import { METRICS } from './types';
import { records as seedRecords, seedChat, seedObservations, seedPhotoObservations } from './data/demo';
import { startClockService, todayNow } from './engine/clock';
import { demoStoredProfile, loadStoredProfile, saveStoredProfile, type StoredProfile } from './store/profileStore';
import FirstRunGate from './components/FirstRunGate';
import OnboardingFlow from './components/OnboardingFlow';
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
import { collectFamilyNotifications, collectGatedFindings } from './engine/escalate';
import { visibleFamilyEvents } from './engine/familyLedger';
import { PersistentHealthRecordStore } from './store/PersistentHealthRecordStore';
import { createIdbKeyValueStore } from './store/IdbKeyValueStore';
import { clearAllLocalData } from './store/clearLocalData';

// 健康数据在本浏览器内持久化（IndexedDB）；IDB 不可用（隐私模式等）时退化为会话内存。
const healthRecordStore = new PersistentHealthRecordStore(
  typeof indexedDB !== 'undefined' ? createIdbKeyValueStore() : null,
);
import { useNotificationDispatch } from './hooks/useNotificationDispatch';
import { pushPermission, requestPushPermission } from './adapters/BrowserNotificationChannel';
import { loadWebhookConfig, sendWebhookPush } from './adapters/WebhookPushChannel';
import { useCrossDeviceSync } from './hooks/useCrossDeviceSync';
import type { CrossTabMessageEnvelope } from './hooks/useCrossTabSync';
import { connectToPeer } from './adapters/PeerJSCrossDevice';
import type { FamilyLinkMessage } from './engine/familyLinkHandshake';
import type { FamilyLinkTransport } from './hooks/useFamilyBinding';
import { lazy, Suspense } from 'react';
import ElderHome from './components/ElderHome';

// 家属端主视图与老人端的可选状态页按需加载：
// 老人用旧手机/弱网打开时不必下载家属端整个仪表盘（审查反馈：首屏体积）。
const FamilyDashboard = lazy(() => import('./components/FamilyDashboard'));
const ProfileView = lazy(() => import('./components/ProfileView'));

const VIEW_FALLBACK = <div className="boot-splash">正在打开…</div>;
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

function buildSeedSnapshot(): { events: HealthEvent[]; familyEvents: FamilyHealthEvent[]; chat: ChatMessage[] } {
  clearLegacyHealthStorage();
  const events = legacySnapshotToEvents({
    records: seedRecords,
    observations: [...seedObservations, ...seedPhotoObservations],
    measurements: [],
    labResults: [],
  });
  return { events, familyEvents: [], chat: seedChat };
}

/** personal 模式的起点：一切从空白开始，检测只对真实输入发声（评审 P1-2）。 */
function emptySnapshot(): { events: HealthEvent[]; familyEvents: FamilyHealthEvent[]; chat: ChatMessage[] } {
  return { events: [], familyEvents: [], chat: [] };
}

function initialHomeSafetyActions(): HomeSafetyAction[] {
  clearLegacyHomeSafetyStorage();
  return demoHomeSafetyActions.map((action) => ({ ...action }));
}

export default function App() {
  // 启动先水合本地持久化的历史数据与本机档案，再进入主界面：
  // 否则首帧的 save 会把 IndexedDB 里的历史快照覆盖成种子数据。
  const [initial, setInitial] = useState<ReturnType<typeof buildSeedSnapshot> | null>(null);
  const [storedProfile, setStoredProfile] = useState<StoredProfile | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = loadStoredProfile();
      const restored = await healthRecordStore.hydrate();
      if (cancelled) return;
      setStoredProfile(stored);
      setProfileReady(true);
      // 有历史数据一律优先采用（那是用户自己的记录）；无历史时才按数据模式装载：
      // demo = 合成种子，personal = 从空白开始（评审 P0-4/P1-2：身份与数据模式是显式选择）。
      if (restored) setInitial(healthRecordStore.load());
      else if (stored?.dataMode === 'demo') setInitial(buildSeedSnapshot());
      else setInitial(emptySnapshot());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!profileReady || !initial) {
    return (
      <div className="app">
        <div className="boot-splash" role="status">
          正在打开…
        </div>
      </div>
    );
  }
  if (!storedProfile) {
    if (onboarding) {
      return (
        <OnboardingFlow
          onComplete={(profile) => {
            const next: StoredProfile = { version: 1, profile, dataMode: 'personal' };
            saveStoredProfile(next);
            setStoredProfile(next);
          }}
        />
      );
    }
    return (
      <FirstRunGate
        onDemo={() => {
          const next = demoStoredProfile();
          saveStoredProfile(next);
          setStoredProfile(next);
          if (initial.events.length === 0 && initial.chat.length === 0) setInitial(buildSeedSnapshot());
        }}
        onPersonal={() => setOnboarding(true)}
      />
    );
  }
  return <AppRoot initial={initial} storedProfile={storedProfile} onProfileChange={setStoredProfile} />;
}

function AppRoot({
  initial,
  storedProfile,
  onProfileChange,
}: {
  initial: ReturnType<typeof buildSeedSnapshot>;
  storedProfile: StoredProfile;
  onProfileChange: (next: StoredProfile) => void;
}) {
  const demoMode = storedProfile.dataMode === 'demo';
  const [events, setEvents] = useState<HealthEvent[]>(initial.events);
  const [familyEvents, setFamilyEvents] = useState<FamilyHealthEvent[]>(initial.familyEvents);
  const [chat, setChat] = useState<ChatMessage[]>(initial.chat);
  const [homeSafetyActions, setHomeSafetyActions] = useState<HomeSafetyAction[]>(initialHomeSafetyActions);
  const [role, setRole] = useState<UserRole | null>(null);
  const [familyView, setFamilyView] = useState<'home' | 'detail' | 'report' | 'medication'>('home');
  const [toast, setToast] = useState<string | null>(null);
  // 时钟服务（评审 P1-4）：运行期的"今天"是可对时的 state，不再是模块加载时定格的常量。
  // 每分钟 tick + 页面从后台恢复时对时；跨午夜后新消息/新任务/新检测都算新的一天。
  const [today, setToday] = useState(() => todayNow());
  useEffect(() => {
    const clock = startClockService(setToday);
    return () => clock.stop();
  }, []);
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
    confirmLinkRequest,
    shareFindingIds,
    shareFamilyEventIds,
  } = useFamilyBinding({ showToast, today });

  const activeProfile: ElderProfile = useMemo(
    () => ({ ...storedProfile.profile, familySharing }),
    [storedProfile, familySharing],
  );
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
  const findings = useMemo(() => runDetection(events, today), [events, today]);
  const agentContext = useMemo(
    () => buildAgentContext(activeProfile, events, today, findings),
    [activeProfile, events, today, findings],
  );
  const familyNotifs = useMemo(
    () => collectFamilyNotifications(findings, familySharing, sharedFindingIds, today),
    [findings, familySharing, sharedFindingIds, today],
  );
  // 第三种未知（评审 P0-2）：今日存在但被隐私门控挡住的 alert/urgent 数量。
  // 家属首页状态必须知道它，否则会把被挡住的紧急信号表述成"今天总体正常"。
  const gatedAlertCount = useMemo(
    () => collectGatedFindings(findings, familySharing, sharedFindingIds, today).length,
    [findings, familySharing, sharedFindingIds, today],
  );
  // 今日信号量：主诉 / 聊天 / 设备 / 拍照 任一来源今天有事件就算一条。
  // 这条计数是 dashboardStatus 区分"今日真的没事"和"今日还没说话"的关键输入。
  const todaySignalCount = useMemo(
    () => events.filter((event) => typeof event.timestamp === 'string' && event.timestamp.startsWith(today)).length,
    [events, today],
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
  const { broadcastLocal } = sync;
  /**
   * 绑定握手通道（P0-2）：家属端 bindFamily 用它走 L2（BroadcastChannel）与
   * L3（PeerJS 临时拨号）。校验发生在拥有邀请码的老人端，输入方不再依赖
   * 本地内存里恰好有这个码。
   */
  const familyLinkTransport = useMemo(
    () => ({
      broadcast: (type: string, payload: unknown) =>
        sync.broadcast(type as Parameters<typeof sync.broadcast>[0], payload),
      subscribe: (handler: (envelope: { type: string; payload: unknown }) => void) =>
        sync.subscribe(handler as Parameters<typeof sync.subscribe>[0]),
      dialPeer: async (code: string) => {
        const handle = await connectToPeer(code);
        return {
          send: (message: unknown) => handle.broadcast(message),
          onMessage: (onData: (message: unknown) => void) => handle.onMessage(onData),
          close: () => handle.destroy(),
        };
      },
    }),
    [sync],
  );
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

  // 另一端广播来的"今日信号摘要"（P0-1 配套，只有数量没有内容）：
  // 跨设备时家属端自己的事件流是空的，必须用老人端广播来的数量才能如实显示
  // "有信号但被隐私挡住"，而不是"今天还没有任何健康信号"。
  const [remoteSignalSummary, setRemoteSignalSummary] = useState<{
    today: string;
    signalCount: number;
    gatedAlertCount: number;
  } | null>(null);

  // 把本地派发台账的变更广播给其它 tab，让"老人端"和"家属端"在同一浏览器内
  // 互相能看到对方的动作。这是真跨设备同步上线前最诚实的演示形态：
  // 至少不是切同一个 useState。
  const familyLinkRequestRef = useRef(confirmLinkRequest);
  familyLinkRequestRef.current = confirmLinkRequest;
  useEffect(() => {
    const unsubscribe = sync.subscribe((envelope: CrossTabMessageEnvelope) => {
      if (envelope.type === 'dispatch.acknowledge') {
        const payload = envelope.payload as { findingId: string };
        mergeAcknowledge(payload.findingId);
      } else if (envelope.type === 'dispatch.append') {
        const record = envelope.payload as import('./engine/notify').FamilyNotificationRecord;
        mergeRecord(record);
      } else if (envelope.type === 'events.append') {
        // P0-1 配套：同浏览器 tab 间的健康事件补齐（只走 BroadcastChannel，不会来自别的设备）。
        // 与 IndexedDB 同一信任域：刷新后本来就能看到这些事件，这里只是让同浏览器实时一致。
        const payload = envelope.payload as { events?: unknown[] };
        const incoming = Array.isArray(payload?.events) ? (payload.events as HealthEvent[]) : [];
        if (incoming.length > 0) setEvents((current) => mergeHealthEvents(current, incoming));
      } else if (envelope.type === 'signals.summary') {
        const payload = envelope.payload as { today?: string; signalCount?: number; gatedAlertCount?: number };
        if (
          typeof payload?.today === 'string' &&
          typeof payload.signalCount === 'number' &&
          typeof payload.gatedAlertCount === 'number'
        ) {
          setRemoteSignalSummary({
            today: payload.today,
            signalCount: payload.signalCount,
            gatedAlertCount: payload.gatedAlertCount,
          });
        }
      } else if (envelope.type === 'family.link') {
        // P0-2：绑定握手。只有老人端应答（家属端保持沉默，避免多 tab 时错误的
        // rejected 抢在正确的 accepted 之前到达）；accepted/rejected 的消费方是
        // 等待中的 bindFamily 握手，这里只处理 request。
        const payload = envelope.payload as Partial<FamilyLinkMessage>;
        if (payload?.kind !== 'request' || typeof payload.requestId !== 'string' || typeof payload.code !== 'string')
          return;
        if (role !== 'elder') return;
        const link = familyLinkRequestRef.current(payload.code);
        sync.broadcast(
          'family.link',
          link
            ? { kind: 'accepted', requestId: payload.requestId, link }
            : { kind: 'rejected', requestId: payload.requestId, reason: 'code_mismatch' },
        );
        if (link) showToast('家属已通过邀请码绑定成功。');
      }
    });
    return unsubscribe;
  }, [sync, mergeAcknowledge, mergeRecord, role, showToast]);

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

  // 老人端广播今日信号摘要（P0-1 配套，只有数量没有内容，隐私安全）。
  // broadcast 内部按签名去重：数值不变时不会反复发。
  useEffect(() => {
    if (role !== 'elder') return;
    sync.broadcast('signals.summary', { today, signalCount: todaySignalCount, gatedAlertCount });
  }, [role, sync, today, todaySignalCount, gatedAlertCount]);

  // 家属端可见的信号量取"本 tab 计算"与"老人端广播"的较大值：
  // 同浏览器双 tab 靠 events.append 已能对齐；跨设备时本 tab 没有事件流，
  // 只能靠摘要数量如实呈现，绝不把"另一端有事"显示成"总体正常"。
  const remoteSummaryForToday = remoteSignalSummary && remoteSignalSummary.today === today ? remoteSignalSummary : null;
  const combinedSignalCount = Math.max(todaySignalCount, remoteSummaryForToday?.signalCount ?? 0);
  const combinedGatedCount = Math.max(gatedAlertCount, remoteSummaryForToday?.gatedAlertCount ?? 0);
  const { tasks, updateStatus, ensureMedicationCheck } = useCareTasks({ findings, today });
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
    today,
    familySharing,
    events,
    chat,
    findings,
    agentContext,
    setEvents,
    setFamilyEvents,
    setChat,
    showToast,
    onMedicationMissed: () => ensureMedicationCheck(activeProfile.medications),
    onShareFindingIds: shareFindingIds,
    onShareFamilyEventIds: shareFamilyEventIds,
    onBroadcastEvents: (incoming) => broadcastLocal('events.append', { events: incoming }),
  });

  useEffect(() => {
    // 模拟设备数据只属于演示模式；personal 模式不注入任何合成数据（评审 P1-2）。
    if (!demoMode) return;
    let cancelled = false;
    const from = seedRecords[0]?.date ?? today;
    demoDeviceAdapter.getMeasurements(activeProfile.name, from, today).then((deviceMeasurements) => {
      if (cancelled) return;
      setEvents((current) => mergeHealthEvents(current, deviceMeasurements.map(measurementToEvent)));
    });
    return () => {
      cancelled = true;
    };
  }, [demoMode, activeProfile.name, today]);

  useEffect(() => {
    // 开应用就生成今天的"💊 今天的药"任务；没有录入用药时不制造噪声。
    if (activeProfile.medications.length === 0) return;
    ensureMedicationCheck(activeProfile.medications);
  }, [activeProfile.medications, ensureMedicationCheck]);

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

  // 评审 P0-4：删档重来。试玩产生的测试主诉会永久影响基线，必须有用户可达的清空入口。
  // clearAllLocalData 会连本机档案一起清掉，reload 后回到首启选择。
  function handleClearAllData() {
    if (!window.confirm('确定清空这台浏览器里的全部记录吗？\n聊天、健康记录、通知台账和设置都会删除，并回到初始选择。'))
      return;
    clearAllLocalData(healthRecordStore);
    window.location.reload();
  }

  // 编辑档案（评审 P0-4）：保存到本机档案存储并即时生效。
  function handleProfileSave(nextProfile: ElderProfile) {
    const next: StoredProfile = { ...storedProfile, profile: nextProfile };
    saveStoredProfile(next);
    onProfileChange(next);
    showToast('档案已更新。');
  }

  // 评审 P1-3：老人端 SOS 的微信通知家属动作。发送结果如实提示，不假装成功。
  async function handleNotifyFamilyUrgent() {
    const config = loadWebhookConfig();
    if (!config) return;
    const outcome = await sendWebhookPush(config, {
      title: `紧急求助：${activeProfile.name}`,
      body: '老人在安康助手按下了紧急求助按钮，请立即电话联系确认安全。',
    });
    showToast(
      outcome.status === 'sent' ? '已通过微信通知家属。请同时保持电话畅通。' : `微信通知没有成功：${outcome.detail}`,
    );
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
            dataMode={storedProfile.dataMode}
            onNotifyFamily={() => void handleNotifyFamilyUrgent()}
          />
          <details className="advanced-details">
            <summary>查看我的状态（可选）</summary>
            <Suspense fallback={VIEW_FALLBACK}>
              <ProfileView
                records={records}
                observations={observations}
                findings={findings}
                today={today}
                profile={activeProfile}
                dataMode={storedProfile.dataMode}
                onProfileSave={handleProfileSave}
                onClearData={handleClearAllData}
              />
            </Suspense>
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
        <Suspense fallback={VIEW_FALLBACK}>
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
            today={today}
            onTaskStatus={handleTaskStatus}
            onHomeSafetyActionStatus={handleHomeSafetyActionStatus}
            onContactElder={contactElder}
            onContactDoctor={contactDoctor}
            onRevokeSharing={revokeFamilyShare}
            onBindFamily={(code) => bindFamily(code, familyLinkTransport as FamilyLinkTransport)}
            onViewChange={setFamilyView}
            view={familyView}
            syncStatus={sync.status}
            tabId={sync.tabId}
            todaySignalCount={combinedSignalCount}
            gatedAlertCount={combinedGatedCount}
            onClearData={handleClearAllData}
          />
        </Suspense>
      </main>
      {toast && <div className="toast">{toast}</div>}
      <footer className="footer">
        安康助手 · 演示版：所有数据只保存在这台设备上，需要删除时用「数据与设置」里的清空入口。
      </footer>
    </div>
  );
}

export { METRICS };
