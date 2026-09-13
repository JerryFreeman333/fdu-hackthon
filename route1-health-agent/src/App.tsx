import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, ElderProfile, FamilyHealthEvent, FamilyLink, UserRole } from './types';
import type { HomeSafetyAction } from './adapters/HomeSafetyActionAdapter';
import { METRICS } from './types';
import { records as seedRecords, seedChat, seedObservations, seedPhotoObservations } from './data/demo';
import { chatClockLabel, startClockService, todayNow } from './engine/clock';
import { msg } from './engine/agent';
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
import { HealthKitDeviceAdapter } from './adapters/HealthKitDeviceAdapter';
import {
  HEALTHKIT_POLL_INTERVAL_MS,
  healthKitRevisionKey,
  shouldPollHealthKit,
  shouldRefreshHealthKit,
} from './healthkit/autoSync';
import { runtimeConfig, runtimeConfigurationErrors } from './config/runtime';
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
import MedicationPage from './components/MedicationPage';
import HealthArchivePage from './components/HealthArchivePage';
import ElderAssistantPage from './components/ElderAssistantPage';
import ElderHealthPage from './components/ElderHealthPage';
import ElderHomeSpacePage from './components/ElderHomeSpacePage';
import ElderSettingsPage from './components/ElderSettingsPage';
import SafetyActions from './components/SafetyActions';

// 家属端主视图与老人端的可选状态页按需加载：
// 老人用旧手机/弱网打开时不必下载家属端整个仪表盘（审查反馈：首屏体积）。
const FamilyDashboard = lazy(() => import('./components/FamilyDashboard'));
const ProfileView = lazy(() => import('./components/ProfileView'));

const VIEW_FALLBACK = <div className="boot-splash">正在打开…</div>;
import RoleGate from './components/RoleGate';
import FontSizeControl from './components/FontSizeControl';
import DeviceDebugPanel, { type DeviceSyncState } from './components/DeviceDebugPanel';
import RuntimeModeBanner from './components/RuntimeModeBanner';
import MobileTabBar, { type MobileTabItem } from './components/MobileTabBar';
import { useCareTasks } from './hooks/useCareTasks';
import { useElderChat } from './hooks/useElderChat';
import { useFamilyBinding } from './hooks/useFamilyBinding';
import { useFontScale } from './hooks/useFontScale';
import { useHomeTwinIntegration } from './hooks/useHomeTwinIntegration';
import { HomeTwinClient } from './adapters/HomeTwinClient';
import { HomeTwinFindItemTool } from './agent-tools/HomeTwinTool';
import { AgentToolRegistry } from './agent-tools/registry';
import { routeAgentToolIntent } from './agent-tools/intentRouter';
import type { AgentToolInvocation } from './agent-tools/types';

const LEGACY_HEALTH_STORAGE_KEYS = ['ankang-route1-health-records-v1', 'ankang-route1-health-records-v2'];
const LEGACY_HOME_ACTION_KEY = 'ankang-route1-home-safety-actions-v1';
type ElderTab = 'home' | 'medications' | 'health' | 'profile';
type ElderScreen = ElderTab | 'assistant' | 'home_space';
type FamilyView = import('./components/FamilyDashboard').FamilyView;

const ELDER_TABS: readonly MobileTabItem<ElderTab>[] = [
  { id: 'home', label: '首页', icon: 'home' },
  { id: 'medications', label: '药物', icon: 'medication' },
  { id: 'health', label: '健康档案', icon: 'report' },
  { id: 'profile', label: '我的', icon: 'profile' },
];

const FAMILY_TABS: readonly MobileTabItem<FamilyView>[] = [
  { id: 'home', label: '首页', icon: 'home' },
  { id: 'report', label: '周报', icon: 'report' },
  { id: 'messages', label: '消息', icon: 'messages' },
  { id: 'profile', label: '我的', icon: 'profile' },
];

const HOME_TWIN_URL =
  import.meta.env.VITE_HOME_TWIN_URL?.trim() || `${window.location.protocol}//${window.location.hostname}:5174`;
const HOME_TWIN_API_URL = import.meta.env.VITE_HOME_TWIN_API_URL?.trim() || 'http://localhost:8010';

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
  // HealthKit 真实模式 fail-closed：即使本机此前选择过演示模式，也不注入合成数据。
  if (runtimeConfig.deviceMode === 'healthkit') return { events: [], familyEvents: [], chat: [] };
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

function initialHomeSafetyActions(demoMode: boolean): HomeSafetyAction[] {
  clearLegacyHomeSafetyStorage();
  if (!demoMode || runtimeConfig.deviceMode === 'healthkit') return [];
  return demoHomeSafetyActions.map((action) => ({ ...action }));
}

function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function App() {
  // 启动先水合本地持久化的历史数据与本机档案，再进入主界面：
  // 否则首帧的 save 会把 IndexedDB 里的历史快照覆盖成种子数据。
  const [initial, setInitial] = useState<ReturnType<typeof buildSeedSnapshot> | null>(null);
  const [storedProfile, setStoredProfile] = useState<StoredProfile | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [pendingRole, setPendingRole] = useState<UserRole>('elder');
  const [profileReady, setProfileReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = loadStoredProfile();
      // HealthKit 模式不读取可能由 Demo 模式遗留的本地健康快照。
      const restored = runtimeConfig.deviceMode === 'healthkit' ? false : await healthRecordStore.hydrate();
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
          role={pendingRole}
          onComplete={(profile) => {
            const next: StoredProfile = { version: 1, profile, dataMode: 'personal', preferredRole: pendingRole };
            saveStoredProfile(next);
            setStoredProfile(next);
          }}
        />
      );
    }
    return (
      <FirstRunGate
        onDemo={(selectedRole) => {
          const next = demoStoredProfile(selectedRole);
          saveStoredProfile(next);
          setStoredProfile(next);
          if (initial.events.length === 0 && initial.chat.length === 0) setInitial(buildSeedSnapshot());
        }}
        onPersonal={(selectedRole) => {
          setPendingRole(selectedRole);
          setOnboarding(true);
        }}
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
  const [homeSafetyActions, setHomeSafetyActions] = useState<HomeSafetyAction[]>(() =>
    initialHomeSafetyActions(demoMode),
  );
  const [role, setRole] = useState<UserRole | null>(storedProfile.preferredRole ?? null);
  const [familyView, setFamilyView] = useState<FamilyView>('home');
  const [demoSharing, setDemoSharing] = useState(true);
  const [elderScreen, setElderScreen] = useState<ElderScreen>('home');
  const [spaceResult, setSpaceResult] = useState<{ message: string; url?: string } | null>(null);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const demoFamilyLink: FamilyLink = {
    id: 'demo-family-link',
    relation: '儿子',
    displayName: '王强（演示家属）',
    maskedContact: '138****6677',
    inviteCode: 'AN-DEMO-2026',
    status: 'active',
  };
  const [deviceSync, setDeviceSync] = useState<DeviceSyncState>({ status: 'idle', received: [] });
  const homeTwin = useHomeTwinIntegration(HOME_TWIN_API_URL);
  const agentTools = useMemo(
    () =>
      new AgentToolRegistry().register(new HomeTwinFindItemTool(new HomeTwinClient(HOME_TWIN_API_URL), HOME_TWIN_URL)),
    [],
  );

  useEffect(() => {
    if (homeTwin.connection.status !== 'connected') return;
    if (!demoMode && homeTwin.connection.integration.dataMode !== 'real') return;
    setHomeSafetyActions(homeTwin.connection.integration.actions);
  }, [homeTwin.connection, demoMode]);
  const healthKitAdapter = useMemo(
    () => new HealthKitDeviceAdapter(runtimeConfig.healthkitEndpoint, runtimeConfig.healthkitBridgeToken),
    [],
  );
  // 时钟服务（评审 P1-4）：运行期的"今天"是可对时的 state，不再是模块加载时定格的常量。
  // 每分钟 tick + 页面从后台恢复时对时；跨午夜后新消息/新任务/新检测都算新的一天。
  const [today, setToday] = useState(() => todayNow());
  useEffect(() => {
    const clock = startClockService(setToday);
    return () => clock.stop();
  }, []);
  const promptedFamilyFindingIdsRef = useRef(new Set<string>());
  const healthKitSyncInFlightRef = useRef(false);
  const healthKitPollInFlightRef = useRef(false);
  const lastAppliedHealthKitRevisionRef = useRef<string>();
  const { fontScale, setFontScale } = useFontScale(role);
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

  // P1（评审安全项）：绑定握手是否已完成。PeerJS 对端在握手完成前是陌生人，
  // 老人端的信号摘要/告警台账不发往 PeerJS；陌生人对端发来的确认/台账一律忽略。
  // 订阅回调需要在重渲染间读到最新值，走 ref（与 familyLinkRequestRef 同款模式）。
  const familyLinkActive = familyLink?.status === 'active';
  const familyLinkActiveRef = useRef(familyLinkActive);
  familyLinkActiveRef.current = familyLinkActive;

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
        // P1（评审安全项）：未绑定会话的 PeerJS 对端是陌生人——陌生人发来的确认
        // 可能消音紧急告警，一律忽略。同浏览器 BroadcastChannel 与 IndexedDB
        // 同一信任域，不受此限。
        if (envelope.via === 'peer' && !familyLinkActiveRef.current) return;
        const payload = envelope.payload as { findingId: string };
        mergeAcknowledge(payload.findingId);
      } else if (envelope.type === 'dispatch.append') {
        if (envelope.via === 'peer' && !familyLinkActiveRef.current) return;
        const record = envelope.payload as import('./engine/notify').FamilyNotificationRecord;
        mergeRecord(record);
      } else if (envelope.type === 'events.append') {
        // P0-1 配套：同浏览器 tab 间的健康事件补齐（只走 BroadcastChannel，不会来自别的设备）。
        // 与 IndexedDB 同一信任域：刷新后本来就能看到这些事件，这里只是让同浏览器实时一致。
        const payload = envelope.payload as { events?: unknown[] };
        const incoming = Array.isArray(payload?.events) ? (payload.events as HealthEvent[]) : [];
        if (incoming.length > 0) setEvents((current) => mergeHealthEvents(current, incoming));
      } else if (envelope.type === 'signals.summary') {
        // P1：陌生人（未绑定 PeerJS 对端）报来的信号摘要不接受，防止伪造"有急事被挡住"。
        if (envelope.via === 'peer' && !familyLinkActiveRef.current) return;
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
        // 回执只走请求来的通道（P1）：同浏览器 tab 的请求只回 BroadcastChannel，
        // 陌生人拨入的 PeerJS 请求只回 PeerJS——绑定回执不向无关通道广播。
        sync.broadcast(
          'family.link',
          link
            ? { kind: 'accepted', requestId: payload.requestId, link }
            : { kind: 'rejected', requestId: payload.requestId, reason: 'code_mismatch' },
          envelope.via === 'peer' ? { local: false, peer: true } : { local: true, peer: false },
        );
        if (link) showToast('家属已通过邀请码绑定成功。');
      } else if (envelope.type === 'medication.update') {
        if (envelope.via === 'peer' && !familyLinkActiveRef.current) return;
        const payload = envelope.payload as {
          familyId?: string;
          mode?: string;
          name?: string;
          medicationRecords?: ElderProfile['medicationRecords'];
        };
        const allowed = (demoMode && demoSharing) || (familySharing === 'granted' && familyLink?.status === 'active');
        if (
          !allowed ||
          payload?.mode !== storedProfile.dataMode ||
          payload.familyId !== (demoMode ? demoFamilyLink.inviteCode : familyLink?.inviteCode) ||
          payload.name !== activeProfile.name
        )
          return;
        const medicines = payload.medicationRecords;
        if (
          !Array.isArray(medicines) ||
          medicines.length > 200 ||
          !medicines.every(
            (m) =>
              m &&
              ['id', 'name', 'dose', 'purpose', 'times'].every((k) => typeof m[k as keyof typeof m] === 'string') &&
              (m.status === 'active' || m.status === 'stopped'),
          )
        )
          return;
        const next = {
          ...storedProfile,
          profile: {
            ...storedProfile.profile,
            medicationRecords: medicines,
            medications: medicines.filter((m) => m.status === 'active').map((m) => m.name),
          },
        };
        saveStoredProfile(next);
        onProfileChange(next);
        showToast('已收到家人的用药档案更新。');
      }
    });
    return unsubscribe;
  }, [
    sync,
    mergeAcknowledge,
    mergeRecord,
    role,
    showToast,
    demoMode,
    demoSharing,
    familySharing,
    familyLink,
    activeProfile.name,
    storedProfile,
    onProfileChange,
  ]);

  // 本地确认时也广播一份，让另一个 tab 能即时反映出来。
  // P1：PeerJS 通道只在绑定完成后启用——对端是"通过握手验证的家属"才送确认动作。
  const handleAcknowledge = useCallback(
    (findingId: string) => {
      acknowledgeDispatch(findingId);
      sync.broadcast('dispatch.acknowledge', { findingId }, { peer: familyLinkActiveRef.current });
    },
    [acknowledgeDispatch, sync],
  );

  // 把本地新派发的台账广播给其它 tab：另一 tab 的 findings 签名未变，
  // 不会重跑派发引擎，所以不会重复触发系统通知，只接收并合并台账。
  // P1：台账含告警正文，PeerJS 通道只在绑定完成后启用，未绑定对端拿不到内容。
  const lastBroadcastRecordIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentIds = new Set(dispatchRecords.map((record) => record.findingId));
    for (const record of dispatchRecords) {
      if (!lastBroadcastRecordIdsRef.current.has(record.findingId)) {
        sync.broadcast('dispatch.append', record, { peer: familyLinkActiveRef.current });
      }
    }
    lastBroadcastRecordIdsRef.current = currentIds;
  }, [dispatchRecords, sync]);

  // P1：绑定完成瞬间，把既有台账完整补发给刚通过握手的家属端——
  // 绑定前生成的记录此前只走了本地通道，跨设备的家属端还一无所知。
  const lastPeerLedgerSyncRef = useRef(false);
  useEffect(() => {
    if (!familyLinkActive) {
      lastPeerLedgerSyncRef.current = false;
      return;
    }
    if (lastPeerLedgerSyncRef.current) return;
    lastPeerLedgerSyncRef.current = true;
    for (const record of dispatchRecords) {
      sync.broadcast('dispatch.append', record, { local: false, peer: true });
    }
  }, [familyLinkActive, dispatchRecords, sync]);

  // 老人端广播今日信号摘要（P0-1 配套，只有数量没有内容，隐私安全）。
  // broadcast 内部按签名去重（签名含通道选择）：数值不变时不会反复发；
  // P1：PeerJS 通道只在绑定完成后启用，未绑定对端拿不到任何信号量。
  useEffect(() => {
    if (role !== 'elder') return;
    sync.broadcast(
      'signals.summary',
      { today, signalCount: todaySignalCount, gatedAlertCount },
      {
        peer: familyLinkActive,
      },
    );
  }, [role, sync, today, todaySignalCount, gatedAlertCount, familyLinkActive]);

  // 家属端可见的信号量取"本 tab 计算"与"老人端广播"的较大值：
  // 同浏览器双 tab 靠 events.append 已能对齐；跨设备时本 tab 没有事件流，
  // 只能靠摘要数量如实呈现，绝不把"另一端有事"显示成"总体正常"。
  const remoteSummaryForToday = remoteSignalSummary && remoteSignalSummary.today === today ? remoteSignalSummary : null;
  const combinedSignalCount = Math.max(todaySignalCount, remoteSummaryForToday?.signalCount ?? 0);
  const combinedGatedCount = Math.max(gatedAlertCount, remoteSummaryForToday?.gatedAlertCount ?? 0);
  const { tasks, updateStatus, ensureMedicationCheck } = useCareTasks({ findings, today });
  const {
    handleElderSend: handleHealthChatSend,
    handlePhotoImport,
    commitPhotoImport,
    cancelPhotoImport,
    pendingPhoto,
    pendingPhotoKind,
    pendingPhotoError,
    quickInputs,
  } = useElderChat({
    today,
    dataMode: storedProfile.dataMode,
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

  function handleElderSend(text: string) {
    const invocation = routeAgentToolIntent(text);
    if (invocation) return runAgentTool(invocation, text);
    return handleHealthChatSend(text);
  }

  // 手动和自动同步复用同一条 Adapter → HealthEvent → Detection/Finding → Person Twin 链。
  const syncDevice = useCallback(
    async (trigger: 'manual' | 'automatic' = 'manual') => {
      if (healthKitSyncInFlightRef.current) return;
      healthKitSyncInFlightRef.current = true;
      setDeviceSync((current) => ({ ...current, status: 'syncing', error: undefined }));
      try {
        const adapter = runtimeConfig.deviceMode === 'healthkit' ? healthKitAdapter : demoDeviceAdapter;
        const from = runtimeConfig.deviceMode === 'healthkit' ? dateDaysAgo(21) : (seedRecords[0]?.date ?? today);
        const userId = runtimeConfig.deviceMode === 'healthkit' ? runtimeConfig.healthkitUserId : activeProfile.name;
        const deviceMeasurements = await adapter.getMeasurements(userId, from, today);
        const diagnostics = runtimeConfig.deviceMode === 'healthkit' ? healthKitAdapter.lastDiagnostics : undefined;
        setEvents((current) => mergeHealthEvents(current, deviceMeasurements.map(measurementToEvent)));
        if (runtimeConfig.deviceMode === 'healthkit') {
          lastAppliedHealthKitRevisionRef.current = healthKitRevisionKey(diagnostics);
        }
        setDeviceSync({
          status: 'success',
          received: deviceMeasurements,
          lastSyncAt: new Date().toISOString(),
          lastCheckedAt: new Date().toISOString(),
          autoPolling: shouldPollHealthKit(runtimeConfig.deviceMode),
          lastTrigger: trigger,
          diagnostics,
        });
        if (trigger === 'manual') {
          showToast(
            `已同步 ${deviceMeasurements.length} 条${runtimeConfig.deviceMode === 'healthkit' ? '真实 HealthKit' : '演示'}数据。`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setDeviceSync((current) => ({
          ...current,
          status: 'error',
          error: message,
          lastCheckedAt: new Date().toISOString(),
          autoPolling: shouldPollHealthKit(runtimeConfig.deviceMode),
          diagnostics: healthKitAdapter.lastDiagnostics,
        }));
        if (trigger === 'manual') showToast('同步失败，未使用 Demo 数据替代。');
      } finally {
        healthKitSyncInFlightRef.current = false;
      }
    },
    [activeProfile.name, healthKitAdapter, showToast, today],
  );

  useEffect(() => {
    if (!shouldPollHealthKit(runtimeConfig.deviceMode)) return;
    let stopped = false;
    setDeviceSync((current) => ({ ...current, autoPolling: true }));

    const pollDiagnostics = async () => {
      if (healthKitPollInFlightRef.current || healthKitSyncInFlightRef.current) return;
      healthKitPollInFlightRef.current = true;
      try {
        const diagnostics = await healthKitAdapter.getDiagnostics(runtimeConfig.healthkitUserId);
        if (stopped) return;
        setDeviceSync((current) => ({
          ...current,
          diagnostics,
          lastCheckedAt: new Date().toISOString(),
          autoPolling: true,
          error: current.status === 'error' ? undefined : current.error,
          status: current.status === 'error' ? 'idle' : current.status,
        }));
        if (shouldRefreshHealthKit(lastAppliedHealthKitRevisionRef.current, diagnostics)) {
          await syncDevice('automatic');
        }
      } catch (error) {
        if (stopped) return;
        const message = error instanceof Error ? error.message : String(error);
        setDeviceSync((current) => ({
          ...current,
          status: 'error',
          error: message,
          diagnostics: healthKitAdapter.lastDiagnostics,
          lastCheckedAt: new Date().toISOString(),
          autoPolling: true,
        }));
      } finally {
        healthKitPollInFlightRef.current = false;
      }
    };

    void pollDiagnostics();
    const timer = window.setInterval(() => void pollDiagnostics(), HEALTHKIT_POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      setDeviceSync((current) => ({ ...current, autoPolling: false }));
    };
  }, [healthKitAdapter, syncDevice]);

  useEffect(() => {
    // 模拟设备数据只属于演示模式；personal 模式不注入任何合成数据（评审 P1-2）。
    if (!demoMode || runtimeConfig.deviceMode !== 'demo') return;
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
    if (nextRole === 'elder') setElderScreen('home');
    if (nextRole === 'family') setFamilyView('home');
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

  function navigateElder(tab: ElderTab) {
    setElderScreen(tab);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function openAssistant(prompt?: string) {
    setElderScreen('assistant');
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (prompt) void handleElderSend(prompt);
  }

  async function runAgentTool(invocation: AgentToolInvocation, originalText: string) {
    setElderScreen('assistant');
    window.scrollTo({ top: 0, behavior: 'auto' });
    const time = chatClockLabel(today, new Date());
    setChat((current) => [...current, msg('elder', originalText, time, true)]);
    try {
      const result = await agentTools.execute(invocation);
      setSpaceResult({ message: result.message, url: result.target?.url });
      setElderScreen('home_space');
      setChat((current) => [
        ...current,
        msg('agent', result.message, time, true, {
          ...(result.target ? { toolTarget: { ...result.target, source: 'route2-home-twin' as const } } : {}),
        }),
      ]);
    } catch (error) {
      setChat((current) => [
        ...current,
        msg(
          'agent',
          `家庭空间查询失败：${error instanceof Error ? error.message : String(error)}。我不会猜测位置。`,
          time,
          true,
        ),
      ]);
    }
  }

  function openHomeTwinLookup(query: string) {
    return runAgentTool({ name: 'home.find_item', input: { query } }, `帮我找${query}`);
  }

  // 评审 P0-4：删档重来。试玩产生的测试主诉会永久影响基线，必须有用户可达的清空入口。
  // clearAllLocalData 会连本机档案一起清掉，reload 后回到首启选择。
  async function handleClearAllData() {
    if (!window.confirm('确定清空这台浏览器里的全部记录吗？\n聊天、健康记录、通知台账和设置都会删除，并回到初始选择。'))
      return;
    try {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase('ankang-health-attachments');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('请先关闭其他打开档案的标签页'));
      });
    } catch {
      showToast('附件未能清空，请关闭其他标签页后重试。未清除其他记录。');
      return;
    }
    clearAllLocalData(healthRecordStore);
    window.location.reload();
  }

  // 编辑档案（评审 P0-4）：保存到本机档案存储并即时生效。
  function handleProfileSave(nextProfile: ElderProfile) {
    const next: StoredProfile = { ...storedProfile, profile: nextProfile };
    saveStoredProfile(next);
    onProfileChange(next);
    if (
      nextProfile.medicationRecords !== storedProfile.profile.medicationRecords &&
      (demoMode || (familySharing === 'granted' && familyLink?.status === 'active'))
    ) {
      sync.broadcast(
        'medication.update',
        {
          familyId: demoMode ? demoFamilyLink.inviteCode : familyLink?.inviteCode,
          mode: storedProfile.dataMode,
          name: activeProfile.name,
          medicationRecords: nextProfile.medicationRecords,
        },
        { peer: familyLinkActiveRef.current },
      );
    }
    showToast(
      sync.status.mode === 'cross-device'
        ? '档案已保存，更新已发送到家庭连接。'
        : '档案已保存在本机，同浏览器家庭页面可同步更新。',
    );
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

  async function handleHomeSafetyActionStatus(actionId: string, status: HomeSafetyAction['status']) {
    if (status === 'resolved') {
      showToast('只有路线二复扫确认风险消失后，才能标记为已解决。');
      return;
    }
    try {
      await homeTwin.updateAction(actionId, status);
    } catch (error) {
      showToast(`未能同步到家庭空间：${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    setHomeSafetyActions((current) =>
      current.map((action) => (action.id === actionId ? { ...action, status } : action)),
    );
    if (status === 'done') showToast('已记录处理完成；重新扫描后才会确认风险是否消失。');
  }

  function contactElder() {
    // P1 修复（评审：家属端"联系老人"拨的是家属自己的号码）：老人电话是档案里
    // 独立的 elderPhone 字段；没有就如实提示补填，绝不把 familyPhone 冒充老人号码。
    const phone = activeProfile.elderPhone?.trim();
    if (!phone) {
      showToast('档案里还没有老人的电话。请到「编辑我的档案」补上，即可一键拨打。');
      return;
    }
    showToast(`正在拨打老人的电话：${phone}`);
    window.location.href = `tel:${phone}`;
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

  const configurationErrors = runtimeConfigurationErrors();
  if (configurationErrors.length > 0) {
    return (
      <main className="configuration-error">
        <h1>运行配置错误</h1>
        {configurationErrors.map((error) => (
          <p key={error}>{error}</p>
        ))}
      </main>
    );
  }

  if (!role) return <RoleGate onSelect={selectRole} />;

  if (role === 'elder') {
    return (
      <div className={`app elder-app ${elderScreen === 'assistant' ? 'assistant-is-open' : ''}`}>
        {elderScreen !== 'assistant' && (
          <header className="simple-header app-shell-header">
            <div>
              <div className="app-wordmark">安康助手</div>
              <div className="persona-sub">今天 · 安静陪伴，需要时立即帮忙</div>
            </div>
            <button className="emergency-header-button" type="button" onClick={() => setEmergencyOpen(true)}>
              紧急求助
            </button>
          </header>
        )}
        <main className={`content ${elderScreen === 'assistant' ? 'assistant-content' : ''}`}>
          {elderScreen === 'home' && (
            <ElderHome
              profile={activeProfile}
              tasks={tasks}
              findings={findings}
              onTaskStatus={handleTaskStatus}
              onTaskOpen={(task) =>
                task.kind === 'medication_check'
                  ? navigateElder('medications')
                  : openAssistant(`请帮我处理这个待办：${task.title}。${task.description}`)
              }
              onOpenAssistant={openAssistant}
              onOpenHealth={() => navigateElder('health')}
              onOpenHomeSpace={() => {
                setSpaceResult(null);
                setElderScreen('home_space');
                window.scrollTo(0, 0);
              }}
              onRequestFamilyShare={requestFamilyShare}
              onKeepFamilyPrivate={keepFamilyPrivate}
              familyLink={familyLink}
              syncStatus={sync.status}
              homeTwin={homeTwin.connection}
            />
          )}
          {elderScreen === 'assistant' && (
            <ElderAssistantPage
              chat={chat}
              onSend={handleElderSend}
              quickInputs={quickInputs}
              profile={activeProfile}
              dataMode={storedProfile.dataMode}
              onBack={() => navigateElder('home')}
              onEmergency={() => setEmergencyOpen(true)}
            />
          )}
          {elderScreen === 'medications' && (
            <MedicationPage
              profile={activeProfile}
              onSave={handleProfileSave}
              onFind={(name) => void openHomeTwinLookup(name)}
            />
          )}
          {elderScreen === 'health' && (
            <HealthArchivePage
              owner={activeProfile.name}
              demoMode={demoMode}
              onRecognize={(file) => {
                if (!demoMode && !import.meta.env.VITE_HEALTH_VISION_ENDPOINT?.trim()) {
                  showToast('真实识别服务尚未配置，未写入模拟结果。');
                  return;
                }
                void handlePhotoImport(file, 'report');
              }}
            >
              <ElderHealthPage
                profile={activeProfile}
                findings={findings}
                dataMode={storedProfile.dataMode}
                onPhotoImport={(file, kind) => {
                  if (!demoMode && !import.meta.env.VITE_HEALTH_VISION_ENDPOINT?.trim()) {
                    showToast('真实图片识别服务尚未配置，未进行识别，也未写入模拟结果。');
                    return;
                  }
                  return handlePhotoImport(file, kind);
                }}
                onCommitPhoto={commitPhotoImport}
                onCancelPhoto={cancelPhotoImport}
                pendingPhoto={pendingPhoto}
                pendingPhotoKind={pendingPhotoKind}
                pendingPhotoError={pendingPhotoError}
              >
                <Suspense fallback={VIEW_FALLBACK}>
                  <ProfileView records={records} observations={observations} findings={findings} today={today} />
                </Suspense>
              </ElderHealthPage>
              <DeviceDebugPanel
                mode={runtimeConfig.deviceMode}
                state={deviceSync}
                eventCount={events.length}
                findings={findings}
                personTwin={agentContext.personTwin}
                onSync={() => void syncDevice('manual')}
              />
            </HealthArchivePage>
          )}
          {elderScreen === 'home_space' && (
            <>
              <button className="btn-secondary" onClick={() => navigateElder('home')}>
                返回首页
              </button>
              {spaceResult && (
                <section className="card" role="status">
                  <h2>家庭空间查询结果</h2>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{spaceResult.message}</p>
                  {spaceResult.url && (
                    <a className="btn-primary" href={spaceResult.url}>
                      打开路线二中的物品位置
                    </a>
                  )}
                </section>
              )}
              <ElderHomeSpacePage
                demoMode={demoMode}
                profile={activeProfile}
                homeTwinUrl={HOME_TWIN_URL}
                connection={homeTwin.connection}
                onRetry={() => void homeTwin.refresh()}
                onFindItem={(query) => void openHomeTwinLookup(query)}
                onAsk={openAssistant}
              />
            </>
          )}
          {elderScreen === 'profile' && (
            <ElderSettingsPage
              profile={activeProfile}
              familyLink={familyLink}
              syncStatus={sync.status}
              dataMode={storedProfile.dataMode}
              onProfileSave={handleProfileSave}
              onRequestFamilyShare={requestFamilyShare}
              onRevokeFamilyShare={revokeFamilyShare}
              onGenerateInvite={generateInvite}
              onClearData={handleClearAllData}
              onSwitchRole={resetRole}
            >
              <div className={`runtime-banner home-twin-${homeTwin.connection.status}`} role="status">
                <strong>家庭空间：</strong>
                <span>{homeTwin.connection.detail}</span>
                {homeTwin.connection.status === 'offline' && (
                  <button className="btn-secondary" type="button" onClick={() => void homeTwin.refresh()}>
                    重试
                  </button>
                )}
              </div>
              <RuntimeModeBanner />
              <DeviceDebugPanel
                mode={runtimeConfig.deviceMode}
                state={deviceSync}
                eventCount={events.length}
                findings={findings}
                personTwin={agentContext.personTwin}
                onSync={() => void syncDevice('manual')}
              />
            </ElderSettingsPage>
          )}
        </main>
        {elderScreen !== 'assistant' && (
          <MobileTabBar
            items={ELDER_TABS}
            active={elderScreen === 'home_space' ? 'home' : elderScreen}
            onSelect={navigateElder}
          />
        )}
        {emergencyOpen && (
          <div className="emergency-backdrop" role="presentation" onClick={() => setEmergencyOpen(false)}>
            <section
              className="emergency-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="紧急求助"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="sheet-handle" />
              <div className="section-head">
                <div>
                  <div className="eyebrow emergency-eyebrow">紧急情况</div>
                  <h2>现在需要谁来帮助您？</h2>
                </div>
                <button className="sheet-close" type="button" onClick={() => setEmergencyOpen(false)} aria-label="关闭">
                  ×
                </button>
              </div>
              <p className="muted">突然胸痛、喘不上气、意识不清或严重跌倒，请优先拨打 120。</p>
              <SafetyActions profile={activeProfile} />
              {loadWebhookConfig() && (
                <button className="btn-secondary sos-notify-btn" onClick={() => void handleNotifyFamilyUrgent()}>
                  微信通知家属：我需要帮助
                </button>
              )}
            </section>
          </div>
        )}
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  return (
    <div className="app family-app">
      <header className="simple-header app-shell-header family-shell-header">
        <div>
          <div className="app-wordmark">安康家属</div>
          <div className="persona-sub">重要变化与家庭行动</div>
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
            demoMode={demoMode}
            medicationPage={
              <MedicationPage
                title="父母的药物档案"
                profile={activeProfile}
                onSave={handleProfileSave}
                onFind={(name) => void openHomeTwinLookup(name)}
              />
            }
            archivePage={
              <HealthArchivePage
                owner={activeProfile.name}
                demoMode={demoMode}
                onRecognize={(file) => {
                  if (!demoMode && !import.meta.env.VITE_HEALTH_VISION_ENDPOINT?.trim()) {
                    showToast('真实图片识别服务尚未配置，未写入模拟结果。');
                    return;
                  }
                  void handlePhotoImport(file, 'report');
                }}
              >
                <ElderHealthPage
                  profile={activeProfile}
                  findings={findings}
                  dataMode={storedProfile.dataMode}
                  onPhotoImport={(file, kind) => {
                    if (!demoMode && !import.meta.env.VITE_HEALTH_VISION_ENDPOINT?.trim()) {
                      showToast('真实图片识别服务尚未配置，未写入模拟结果。');
                      return;
                    }
                    return handlePhotoImport(file, kind);
                  }}
                  onCommitPhoto={commitPhotoImport}
                  onCancelPhoto={cancelPhotoImport}
                  pendingPhoto={pendingPhoto}
                  pendingPhotoKind={pendingPhotoKind}
                  pendingPhotoError={pendingPhotoError}
                >
                  <p>档案保存在当前浏览器，与同机父母端共用。跨设备附件同步尚未接入。</p>
                </ElderHealthPage>
              </HealthArchivePage>
            }
            profile={demoMode ? { ...activeProfile, familySharing: demoSharing ? 'granted' : 'denied' } : activeProfile}
            familyLink={demoMode ? demoFamilyLink : familyLink}
            notifications={
              demoMode
                ? demoSharing
                  ? collectFamilyNotifications(findings, 'granted', sharedFindingIds, today)
                  : []
                : familyNotifs
            }
            dispatchRecords={dispatchRecords}
            onAcknowledgeDispatch={handleAcknowledge}
            findings={findings}
            familyEvents={demoMode ? (demoSharing ? familyEvents : []) : visibleFamilyFacts}
            tasks={tasks}
            homeSafetyActions={homeSafetyActions}
            homeTwinUrl={HOME_TWIN_URL}
            homeTwinConnection={homeTwin.connection}
            records={familyRecords}
            today={today}
            onTaskStatus={handleTaskStatus}
            onHomeSafetyActionStatus={handleHomeSafetyActionStatus}
            onContactElder={contactElder}
            onContactDoctor={contactDoctor}
            onRevokeSharing={() => {
              setDemoSharing(false);
              revokeFamilyShare();
            }}
            onBindFamily={(code) => bindFamily(code, familyLinkTransport as FamilyLinkTransport)}
            onViewChange={setFamilyView}
            view={familyView}
            syncStatus={sync.status}
            tabId={sync.tabId}
            todaySignalCount={combinedSignalCount}
            gatedAlertCount={demoMode && demoSharing ? 0 : combinedGatedCount}
            onClearData={handleClearAllData}
          />
        </Suspense>
      </main>
      <MobileTabBar
        items={FAMILY_TABS}
        active={
          familyView === 'profile' || familyView === 'privacy'
            ? 'profile'
            : familyView === 'report'
              ? 'report'
              : familyView === 'messages' || familyView === 'detail'
                ? 'messages'
                : 'home'
        }
        onSelect={setFamilyView}
      />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export { METRICS };
