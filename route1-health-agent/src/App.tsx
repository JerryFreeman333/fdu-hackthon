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
import { lazy, Suspense } from 'react';
import ElderHome from './components/ElderHome';
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

const LEGACY_HEALTH_STORAGE_KEYS = ['ankang-route1-health-records-v1', 'ankang-route1-health-records-v2'];
const LEGACY_HOME_ACTION_KEY = 'ankang-route1-home-safety-actions-v1';
type ElderTab = 'home' | 'health' | 'home_space' | 'profile';
type ElderScreen = ElderTab | 'assistant';
type FamilyView = 'home' | 'tasks' | 'report' | 'profile' | 'detail' | 'medication';

const ELDER_TABS: readonly MobileTabItem<ElderTab>[] = [
  { id: 'home', label: '首页', icon: 'home' },
  { id: 'health', label: '健康', icon: 'health' },
  { id: 'home_space', label: '我的家', icon: 'space' },
  { id: 'profile', label: '我的', icon: 'profile' },
];

const FAMILY_TABS: readonly MobileTabItem<'home' | 'tasks' | 'report' | 'profile'>[] = [
  { id: 'home', label: '首页', icon: 'home' },
  { id: 'tasks', label: '待处理', icon: 'tasks' },
  { id: 'report', label: '周报', icon: 'report' },
  { id: 'profile', label: '我的', icon: 'profile' },
];

const HOME_TWIN_URL = import.meta.env.VITE_HOME_TWIN_URL?.trim() || 'http://localhost:5174';

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

function initialHomeSafetyActions(): HomeSafetyAction[] {
  clearLegacyHomeSafetyStorage();
  if (runtimeConfig.deviceMode === 'healthkit') return [];
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
  const [familyView, setFamilyView] = useState<FamilyView>('home');
  const [elderScreen, setElderScreen] = useState<ElderScreen>('home');
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [deviceSync, setDeviceSync] = useState<DeviceSyncState>({ status: 'idle', received: [] });
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
  });

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
              onOpenAssistant={() => openAssistant()}
              onOpenHealth={() => navigateElder('health')}
              onOpenHomeSpace={() => navigateElder('home_space')}
              onRequestFamilyShare={requestFamilyShare}
              onKeepFamilyPrivate={keepFamilyPrivate}
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
          {elderScreen === 'health' && (
            <ElderHealthPage
              profile={activeProfile}
              findings={findings}
              dataMode={storedProfile.dataMode}
              onPhotoImport={handlePhotoImport}
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
          )}
          {elderScreen === 'home_space' && (
            <ElderHomeSpacePage profile={activeProfile} homeTwinUrl={HOME_TWIN_URL} onAsk={openAssistant} />
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
          <MobileTabBar items={ELDER_TABS} active={elderScreen} onSelect={navigateElder} />
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
            profile={activeProfile}
            familyLink={familyLink}
            notifications={familyNotifs}
            dispatchRecords={dispatchRecords}
            onAcknowledgeDispatch={handleAcknowledge}
            findings={findings}
            familyEvents={visibleFamilyFacts}
            tasks={tasks}
            homeSafetyActions={homeSafetyActions}
            homeTwinUrl={HOME_TWIN_URL}
            records={familyRecords}
            today={today}
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
            gatedAlertCount={gatedAlertCount}
            onClearData={handleClearAllData}
          />
        </Suspense>
      </main>
      <MobileTabBar
        items={FAMILY_TABS}
        active={familyView === 'detail' ? 'tasks' : familyView === 'medication' ? 'profile' : familyView}
        onSelect={setFamilyView}
      />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export { METRICS };
