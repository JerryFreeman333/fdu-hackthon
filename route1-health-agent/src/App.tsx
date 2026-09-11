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
import { HealthKitDeviceAdapter } from './adapters/HealthKitDeviceAdapter';
import { runtimeConfig, runtimeConfigurationErrors } from './config/runtime';
import { runDetection } from './engine/detect';
import { buildAgentContext } from './engine/context';
import { collectFamilyNotifications } from './engine/escalate';
import { visibleFamilyEvents } from './engine/familyLedger';
import { healthRecordStore } from './store/LocalHealthRecordStore';
import ElderHome from './components/ElderHome';
import FamilyDashboard from './components/FamilyDashboard';
import ProfileView from './components/ProfileView';
import RoleGate from './components/RoleGate';
import FontSizeControl from './components/FontSizeControl';
import DeviceDebugPanel, { type DeviceSyncState } from './components/DeviceDebugPanel';
import RuntimeModeBanner from './components/RuntimeModeBanner';
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
  if (runtimeConfig.deviceMode === 'healthkit') return { events: [], familyEvents: [], chat: [] };
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
  const initial = useMemo(() => initialSnapshot(), []);
  const [events, setEvents] = useState<HealthEvent[]>(initial.events);
  const [familyEvents, setFamilyEvents] = useState<FamilyHealthEvent[]>(initial.familyEvents);
  const [chat, setChat] = useState<ChatMessage[]>(initial.chat);
  const [homeSafetyActions, setHomeSafetyActions] = useState<HomeSafetyAction[]>(initialHomeSafetyActions);
  const [role, setRole] = useState<UserRole | null>(null);
  const [familyView, setFamilyView] = useState<'home' | 'detail' | 'report'>('home');
  const [toast, setToast] = useState<string | null>(null);
  const [deviceSync, setDeviceSync] = useState<DeviceSyncState>({ status: 'idle', received: [] });
  const healthKitAdapter = useMemo(
    () => new HealthKitDeviceAdapter(runtimeConfig.healthkitEndpoint, runtimeConfig.healthkitBridgeToken),
    [],
  );
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
    claimOneTimeShares,
    consumeSharedFindingIds,
    consumeSharedFamilyEventIds,
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
    () => collectFamilyNotifications(findings, familySharing, sharedFindingIds),
    [findings, familySharing, sharedFindingIds],
  );
  const { tasks, updateStatus, ensureMedicationCheck } = useCareTasks({ findings });
  const { handleElderSend, handlePhotoImport, quickInputs } = useElderChat({
    familySharing,
    events,
    chat,
    findings,
    agentContext,
    setEvents,
    setFamilyEvents,
    setChat,
    showToast,
    onMedicationMissed: ensureMedicationCheck,
    onShareFindingIds: shareFindingIds,
    onShareFamilyEventIds: shareFamilyEventIds,
  });

  const syncDevice = useCallback(async () => {
    setDeviceSync((current) => ({ ...current, status: 'syncing', error: undefined }));
    try {
      const adapter = runtimeConfig.deviceMode === 'healthkit' ? healthKitAdapter : demoDeviceAdapter;
      const from = runtimeConfig.deviceMode === 'healthkit' ? dateDaysAgo(21) : (seedRecords[0]?.date ?? TODAY);
      const userId = runtimeConfig.deviceMode === 'healthkit' ? runtimeConfig.healthkitUserId : profile.name;
      const deviceMeasurements = await adapter.getMeasurements(userId, from, TODAY);
      setEvents((current) => mergeHealthEvents(current, deviceMeasurements.map(measurementToEvent)));
      setDeviceSync({
        status: 'success',
        received: deviceMeasurements,
        lastSyncAt: new Date().toISOString(),
        diagnostics: healthKitAdapter.lastDiagnostics,
      });
      showToast(
        `已同步 ${deviceMeasurements.length} 条${runtimeConfig.deviceMode === 'healthkit' ? '真实 HealthKit' : '演示'}数据。`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDeviceSync({ status: 'error', received: [], error: message, diagnostics: healthKitAdapter.lastDiagnostics });
      showToast('同步失败，未使用 Demo 数据替代。');
    }
  }, [healthKitAdapter, showToast]);

  useEffect(() => {
    if (runtimeConfig.deviceMode !== 'demo') return;
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

  useEffect(() => {
    if (role !== 'family' || familyLink?.status !== 'active') return;
    const oneTimeFindingIds = familyNotifs
      .filter((notification) => notification.oneTime)
      .map((notification) => notification.finding.id);
    const oneTimeFamilyEventIds = visibleFamilyFacts
      .filter((event) => event.shareMode === 'one_time')
      .map((event) => event.id);
    void claimOneTimeShares(oneTimeFindingIds, oneTimeFamilyEventIds);
  }, [role, familyLink?.status, familyNotifs, visibleFamilyFacts, claimOneTimeShares]);

  function selectRole(nextRole: UserRole) {
    setRole(nextRole);
  }

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
    showToast(`演示联系：${activeProfile.familyContact}`);
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
          <RuntimeModeBanner />
          <ElderHome
            profile={activeProfile}
            chat={chat}
            onSend={handleElderSend}
            onPhotoImport={handlePhotoImport}
            quickInputs={quickInputs}
            tasks={tasks}
            findings={findings}
            familyLink={familyLink}
            onTaskStatus={handleTaskStatus}
            onRequestFamilyShare={requestFamilyShare}
            onKeepFamilyPrivate={keepFamilyPrivate}
            onRevokeFamilyShare={revokeFamilyShare}
            onGenerateInvite={generateInvite}
          />
          <details className="advanced-details">
            <summary>查看我的状态（可选）</summary>
            <ProfileView records={records} observations={observations} findings={findings} today={TODAY} />
          </details>
          <DeviceDebugPanel
            mode={runtimeConfig.deviceMode}
            state={deviceSync}
            eventCount={events.length}
            findings={findings}
            personTwin={agentContext.personTwin}
            onSync={() => void syncDevice()}
          />
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
        <RuntimeModeBanner />
        <DeviceDebugPanel
          mode={runtimeConfig.deviceMode}
          state={deviceSync}
          eventCount={events.length}
          findings={findings}
          personTwin={agentContext.personTwin}
          onSync={() => void syncDevice()}
        />
        <FamilyDashboard
          profile={activeProfile}
          familyLink={familyLink}
          notifications={familyNotifs}
          findings={findings}
          familyEvents={visibleFamilyFacts}
          tasks={tasks}
          homeSafetyActions={homeSafetyActions}
          records={familyRecords}
          today={TODAY}
          onTaskStatus={handleTaskStatus}
          onHomeSafetyActionStatus={handleHomeSafetyActionStatus}
          onContactElder={contactElder}
          onRevokeSharing={revokeFamilyShare}
          onBindFamily={bindFamily}
          onViewChange={setFamilyView}
          onConsumeFindingShare={consumeSharedFindingIds}
          onConsumeFamilyEventShare={consumeSharedFamilyEventIds}
          view={familyView}
        />
      </main>
      {toast && <div className="toast">{toast}</div>}
      <footer className="footer">
        当前模式：设备 {runtimeConfig.deviceMode} · 图像 {runtimeConfig.healthVisionMode} · Agent{' '}
        {runtimeConfig.agentMode}。
        {runtimeConfig.deviceMode === 'healthkit' ? '真实模式失败时不会回退到 Demo。' : '当前数据仅用于演示。'}
      </footer>
    </div>
  );
}

export { METRICS };
