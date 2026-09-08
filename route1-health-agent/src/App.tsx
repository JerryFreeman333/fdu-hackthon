import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ElderProfile, UserRole } from './types';
import { METRICS } from './types';
import { TODAY, records as demoRecords, seedObservations, seedPhotoObservations } from './data/demo';
import { legacySnapshotToEvents, materializeHealthData, type HealthEvent } from './pipeline/events';
import { runDetection } from './engine/detect';
import { buildAgentContext } from './engine/context';
import { collectFamilyNotifications } from './engine/escalate';
import { familyEvents, familyTasks, shareObservation } from './engine/familyAccess';
import { emptyProfile, PROFILE_KEY, validateProfile } from './engine/profile';
import { profileAnswer } from './engine/profileInterview';
import { personalHealthRecordStore as healthRecordStore } from './store/LocalHealthRecordStore';
import ElderHome from './components/ElderHome';
import FamilyDashboard from './components/FamilyDashboard';
import FamilySettings from './components/FamilySettings';
import ReportView, { PhotoDemo } from './components/ReportView';
import ProfileSetup, { ProfileSummary } from './components/ProfileSetup';
import RoleGate from './components/RoleGate';
import FontSizeControl from './components/FontSizeControl';
import { useCareTasks } from './hooks/useCareTasks';
import { useElderChat } from './hooks/useElderChat';
import { useFamilyBinding } from './hooks/useFamilyBinding';
import { useFontScale } from './hooks/useFontScale';

const ROLE_KEY = 'ankang-personal-role-v1';
type Page = 'home' | 'report' | 'environment' | 'mine';
const demoEvents = legacySnapshotToEvents({
  records: demoRecords,
  observations: [...seedObservations, ...seedPhotoObservations],
});
function EnvironmentPage() {
  return (
    <section className="card environment-page">
      <div className="eyebrow">家庭环境</div>
      <div className="environment-icon" aria-hidden="true">
        ⌂
      </div>
      <h1>一起了解您住的家</h1>
      <p>未来可以由家属协助拍摄，查看家庭空间、常用物品与需要处理的位置。</p>
      <p className="availability-label">家庭建模功能准备中</p>
      <ol>
        <li>家属查看拍摄指引</li>
        <li>按要求提供照片或视频</li>
        <li>查看模型与需要补拍的位置</li>
      </ol>
      <p className="muted">具体拍摄要求将在建模服务接入后提供。目前无需拍摄，也不会收集或上传家庭影像。</p>
    </section>
  );
}

export default function App() {
  const [initial] = useState(() => healthRecordStore.load());
  const [events, setEvents] = useState<HealthEvent[]>(initial.events);
  const [chat, setChat] = useState(initial.chat);
  const lastSnapshot = useRef(JSON.stringify(initial));
  useEffect(() => {
    function sync(event: StorageEvent) {
      if (event.key !== 'ankang-personal-records-v1' && event.key !== null) return;
      const next = healthRecordStore.load();
      lastSnapshot.current = JSON.stringify(next);
      setEvents(next.events);
      setChat(next.chat);
    }
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const [role, setRole] = useState<UserRole | null>(() => {
    try {
      const value = sessionStorage.getItem(ROLE_KEY) ?? localStorage.getItem(ROLE_KEY);
      return value === 'elder' || value === 'family' ? value : null;
    } catch {
      return null;
    }
  });
  const [profileLoad] = useState(() => {
    try {
      const value = localStorage.getItem(PROFILE_KEY);
      return { profile: value ? validateProfile(JSON.parse(value)) : null, error: '' };
    } catch {
      return { profile: null, error: '原有档案暂时无法读取，请检查浏览器存储或重新确认资料。' };
    }
  });
  const [savedProfile, setSavedProfile] = useState<ElderProfile | null>(profileLoad.profile);
  const [setupStep, setSetupStep] = useState<'binding' | 'profile'>('binding');
  const [editing, setEditing] = useState(false);
  const [page, setPage] = useState<Page>('home');
  const [showDemo, setShowDemo] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(profileLoad.error);
  const storageFailed = useCallback(
    () => setStorageError('浏览器未能保存数据。当前修改可能在关闭页面后丢失，请检查存储权限后重试。'),
    [],
  );
  const showToast = useCallback((value: string) => setToast(value), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  const { fontScale, setFontScale } = useFontScale();
  const binding = useFamilyBinding({ showToast, onStorageError: storageFailed });
  const seenBindingId = useRef(binding.familyLink?.status === 'active' ? binding.familyLink.id : null);
  useEffect(() => {
    const link = binding.familyLink;
    if (role !== 'elder' || link?.status !== 'active') return;
    if (seenBindingId.current === link.id) return;
    seenBindingId.current = link.id;
    setSetupStep('profile');
    setPage('home');
    setEditing(false);
    setShowDemo(false);
    showToast('家属已绑定成功，已为您打开阿安。健康资料仍由您决定是否共享。');
  }, [role, binding.familyLink, showToast, storageFailed]);
  const activeProfile = useMemo(
    () => ({ ...(savedProfile ?? emptyProfile), familySharing: binding.familySharing }),
    [savedProfile, binding.familySharing],
  );
  const healthData = useMemo(() => materializeHealthData(events), [events]);
  const findings = useMemo(() => runDetection(events, TODAY), [events]);
  const agentContext = useMemo(
    () => buildAgentContext(activeProfile, events, TODAY, findings),
    [activeProfile, events, findings],
  );
  const { tasks, updateStatus, ensureMedicationCheck } = useCareTasks({ findings, onStorageError: storageFailed });
  const elderChat = useElderChat({
    profile: activeProfile,
    familySharing: binding.familySharing,
    familyBound: binding.familyLink?.status === 'active',
    events,
    chat,
    findings,
    agentContext,
    setEvents,
    setChat,
    showToast,
    onMedicationMissed: ensureMedicationCheck,
    onShareFindingIds: binding.shareFindingIds,
  });
  const sharedEvents = useMemo(
    () => familyEvents(events, binding.familySharing, binding.familyLink),
    [events, binding.familySharing, binding.familyLink],
  );
  const sharedData = useMemo(() => materializeHealthData(sharedEvents), [sharedEvents]);
  const sharedFindings = useMemo(() => runDetection(sharedEvents, TODAY), [sharedEvents]);
  const sharedTasks = familyTasks(tasks, findings, binding.familySharing, binding.familyLink);
  const notifications =
    binding.familyLink?.status === 'active' ? collectFamilyNotifications(sharedFindings, 'granted', []) : [];
  useEffect(() => {
    try {
      const snapshot = { events, chat: chat.filter((item) => item.persisted !== false) };
      const serialized = JSON.stringify(snapshot);
      if (serialized !== lastSnapshot.current) {
        healthRecordStore.save(snapshot);
        lastSnapshot.current = serialized;
      }
    } catch {
      storageFailed();
    }
  }, [events, chat, storageFailed]);

  function selectRole(value: UserRole) {
    setRole(value);
    setSetupStep('binding');
    setPage('home');
    setEditing(false);
    setShowDemo(false);
    try {
      localStorage.setItem(ROLE_KEY, value);
      sessionStorage.setItem(ROLE_KEY, value);
    } catch {
      storageFailed();
    }
  }
  function switchRole() {
    setRole(null);
    setEditing(false);
    try {
      localStorage.removeItem(ROLE_KEY);
      sessionStorage.removeItem(ROLE_KEY);
    } catch {
      storageFailed();
    }
  }
  function resetTestRecords() {
    try {
      healthRecordStore.clear();
      localStorage.removeItem(PROFILE_KEY);
      localStorage.removeItem('ankang-personal-tasks-v1');
      localStorage.removeItem('ankang-personal-shared-findings-v1');
      window.location.reload();
    } catch {
      storageFailed();
    }
  }
  function persistProfile(value: ElderProfile) {
    const clean = validateProfile(value);
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(clean));
    } catch {
      throw new Error('资料未能保存。请检查浏览器存储权限，您的填写内容仍在此页。');
    }
    setSavedProfile(clean);
    setStorageError('');
  }
  function saveProfile(value: ElderProfile) {
    persistProfile(value);
    setEditing(false);
    setChat((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: 'agent',
        text: `基本情况已经记好了，您可以在“我的”里查看和修改。\n称呼：${profileAnswer(value, 0)}；年龄：${profileAnswer(value, 1)}。\n接下来，您今天想和我聊些什么？`,
        time: new Date().toLocaleString('zh-CN'),
      },
    ]);
    showToast('基本档案已保存，之后可以在“我的”修改。');
  }
  function taskStatus(id: string, status: Parameters<typeof updateStatus>[1]) {
    if (role === 'family' && !sharedTasks.some((task) => task.id === id)) return;
    updateStatus(id, status);
    if (status === 'completed') showToast('已记录处理完成。健康或环境是否改善，需要后续记录确认。');
  }
  function navigate(value: Page) {
    setPage(value);
    setEditing(false);
    setShowDemo(false);
    window.scrollTo({ top: 0 });
  }
  const familySettings = (
    <FamilySettings
      showSharing={!(role === 'elder' && !savedProfile)}
      role={role ?? 'elder'}
      link={binding.familyLink}
      sharing={binding.familySharing}
      onGenerate={binding.generateInvite}
      onBind={binding.bindFamily}
      onGrant={binding.requestFamilyShare}
      onRevoke={() => {
        binding.revokeFamilyShare();
        setEvents((current) =>
          current.map((event) =>
            event.type === 'observation' && event.sharedOnce
              ? { ...event, sharedOnce: false, observation: { ...event.observation, visibility: 'private' } }
              : event,
          ),
        );
      }}
    />
  );

  if (!role) return <RoleGate onSelect={selectRole} />;
  const onboarding = role === 'elder' && (setupStep === 'binding' || !savedProfile?.profileInterviewComplete);
  const tabs: { id: Page; label: string; symbol: string }[] =
    role === 'elder'
      ? [
          { id: 'home', label: '助手', symbol: '◉' },
          { id: 'report', label: '报告', symbol: '▤' },
          { id: 'mine', label: '我的', symbol: '○' },
        ]
      : [
          { id: 'home', label: '概况', symbol: '◉' },
          { id: 'report', label: '健康报告', symbol: '▤' },
          { id: 'environment', label: '家庭环境', symbol: '⌂' },
          { id: 'mine', label: '我的', symbol: '○' },
        ];
  const canRead =
    binding.familyLink?.status === 'active' && (binding.familySharing === 'granted' || sharedEvents.length > 0);
  return (
    <div className="app">
      <header className="simple-header">
        <div>
          <div className="persona-name">
            阿安 <span className="persona-sub">{role === 'elder' ? '老人端' : '家属端'}</span>
          </div>
          <div className="persona-sub">日常有陪伴，变化有记录</div>
        </div>
        <button className="btn-secondary" disabled={elderChat.pending || profileBusy} onClick={switchRole}>
          切换身份
        </button>
        {role === 'elder' && !onboarding && (
          <button className="text-button" onClick={() => navigate('mine')}>
            {binding.familyLink?.status === 'active'
              ? binding.familySharing === 'granted'
                ? '家属已绑定 · 已共享'
                : '家属已绑定 · 未共享'
              : '家属未绑定'}
          </button>
        )}
        {import.meta.env.DEV && role === 'elder' && (
          <button
            className="text-button"
            disabled={elderChat.pending || profileBusy}
            onClick={() => setConfirmReset(true)}
          >
            清空测试记录
          </button>
        )}
      </header>
      {confirmReset && (
        <section className="card" role="alert">
          <p>清空问答、基本资料、健康记录和测试待办？家属绑定和共享设置会保留。此操作无法撤销。</p>
          <button className="btn-primary" onClick={resetTestRecords}>
            确认清空测试记录
          </button>
          <button className="btn-secondary" onClick={() => setConfirmReset(false)}>
            取消
          </button>
        </section>
      )}
      {storageError && (
        <p role="alert" className="form-error">
          {storageError}
        </p>
      )}
      <main className="content">
        {onboarding ? (
          setupStep === 'binding' ? (
            <>
              <section className="welcome">
                <div className="eyebrow">欢迎回来 · 家属绑定</div>
                <h1>{binding.familyLink?.status === 'active' ? '已经和家里人连上了' : '先邀请一位家里人？'}</h1>
                <p>
                  {binding.familyLink?.status === 'active'
                    ? '绑定关系已保留，点下面的按钮就能继续聊天。'
                    : '您也可以先自己使用，之后再绑定。'}
                </p>
              </section>
              {familySettings}
              <div className="form-actions">
                <button className="btn-primary" onClick={() => setSetupStep('profile')}>
                  {binding.familyLink?.status === 'active' ? '进入聊天' : '暂时跳过，开始聊天'}
                </button>
              </div>
            </>
          ) : (
            <ProfileSetup
              initial={activeProfile}
              onSave={saveProfile}
              onProgress={persistProfile}
              onBusyChange={setProfileBusy}
            />
          )
        ) : (
          <>
            {page === 'home' &&
              (role === 'elder' ? (
                <ElderHome
                  profile={activeProfile}
                  chat={chat}
                  onSend={elderChat.handleElderSend}
                  quickInputs={elderChat.quickInputs}
                  tasks={tasks}
                  findings={findings}
                  pending={elderChat.pending}
                  failedText={elderChat.failedText}
                  onRetry={elderChat.retrySend}
                  onTaskStatus={taskStatus}
                />
              ) : binding.familyLink?.status !== 'active' ? (
                familySettings
              ) : (
                <FamilyDashboard
                  notifications={notifications}
                  tasks={sharedTasks}
                  sharing={binding.familySharing}
                  records={sharedData.records}
                  observationCount={sharedData.observations.length}
                  hasUnsharedRecords={events.length > sharedEvents.length}
                  onTaskStatus={taskStatus}
                  onReport={() => navigate('report')}
                />
              ))}
            {page === 'report' &&
              (role === 'family' && !canRead ? (
                <section className="card">
                  <h1>{binding.familyLink?.status !== 'active' ? '请先绑定老人' : '健康报告尚未共享'}</h1>
                  <p>绑定关系和查看权限是两件事。请由老人在“我的”中允许共享。</p>
                  <button className="btn-secondary" onClick={() => navigate('mine')}>
                    查看绑定与权限
                  </button>
                </section>
              ) : (
                <>
                  {role === 'elder' && (
                    <label className="demo-toggle">
                      <input type="checkbox" checked={showDemo} onChange={(e) => setShowDemo(e.target.checked)} />
                      查看独立演示报告（不写入本人记录）
                    </label>
                  )}
                  {showDemo && role === 'elder' ? (
                    <ReportView
                      records={demoRecords}
                      observations={[...seedObservations, ...seedPhotoObservations]}
                      findings={runDetection(demoEvents, TODAY)}
                      today={TODAY}
                      demo
                    />
                  ) : (
                    <ReportView
                      records={role === 'elder' ? healthData.records : sharedData.records}
                      observations={role === 'elder' ? healthData.observations : sharedData.observations}
                      findings={role === 'elder' ? findings : sharedFindings}
                      tasks={role === 'elder' ? tasks : sharedTasks}
                      today={TODAY}
                      audience={role}
                      canShare={binding.familyLink?.status === 'active'}
                      visibleObservationIds={sharedData.observations.map((item) => item.id)}
                      onShareObservation={(id) => {
                        if (binding.familyLink?.status !== 'active' || role !== 'elder') return;
                        setEvents((current) =>
                          shareObservation(current, id, binding.familySharing, binding.familyLink),
                        );
                        showToast('只共享了这条记录，长期共享设置没有改变');
                      }}
                    />
                  )}
                </>
              ))}
            {page === 'environment' && <EnvironmentPage />}
            {page === 'mine' &&
              (editing && role === 'elder' ? (
                <ProfileSetup
                  initial={activeProfile}
                  onSave={saveProfile}
                  onProgress={persistProfile}
                  onCancel={() => setEditing(false)}
                  onBusyChange={setProfileBusy}
                />
              ) : (
                <>
                  <section className="welcome">
                    <div className="eyebrow">我的</div>
                    <h1>{role === 'elder' ? activeProfile.name || '按您的习惯来' : '家庭联系与设置'}</h1>
                  </section>
                  {role === 'elder' && (
                    <section className="card">
                      <div className="section-head">
                        <h2>基本档案</h2>
                        <button className="btn-secondary" onClick={() => setEditing(true)}>
                          修改资料
                        </button>
                      </div>
                      <ProfileSummary profile={activeProfile} />
                      <p className="muted">
                        来源：本人填写 · 更新于{' '}
                        {activeProfile.profileUpdatedAt
                          ? new Date(activeProfile.profileUpdatedAt).toLocaleString('zh-CN')
                          : '暂未填写'}
                        。不作为当日新发生的症状。
                      </p>
                    </section>
                  )}
                  {familySettings}
                  <section className="card settings-card">
                    <h2>阅读与语音</h2>
                    <FontSizeControl value={fontScale} onChange={setFontScale} />
                    <p className="muted">
                      助手回复可以朗读，也可以随时停止。浏览器语音服务可能联网处理音频；不希望使用时可以直接打字。
                    </p>
                  </section>
                  {role === 'elder' && (
                    <section className="card">
                      <h2>了解家里的情况</h2>
                      <p>建模功能准备中，未来可邀请家属协助拍摄。</p>
                      <button className="btn-secondary" onClick={() => navigate('environment')}>
                        查看家庭采集说明
                      </button>
                    </section>
                  )}
                  {role === 'elder' && (
                    <details className="card">
                      <summary>体验演示：模拟识别血压计等照片</summary>
                      <PhotoDemo />
                    </details>
                  )}
                  <details className="card">
                    <summary>当前版本与记录说明</summary>
                    <p>
                      账号与绑定为单浏览器演示；尚未接入跨设备同步、真实设备、照片识别和家庭建模。配置 DeepSeek
                      后，自由问答由模型理解；服务失败时会明确提示。
                    </p>
                    <p>个人记录与历史演示记录分开保存，旧版浏览器数据仍保留，不会作为您的健康事实导入。</p>
                  </details>
                </>
              ))}
          </>
        )}
      </main>
      {!onboarding && (
        <nav className="bottom-nav" aria-label={role === 'elder' ? '老人端导航' : '家属端导航'}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              aria-current={page === tab.id ? 'page' : undefined}
              disabled={elderChat.pending || profileBusy}
              onClick={() => navigate(tab.id)}
            >
              <span aria-hidden="true">{tab.symbol}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
export { METRICS };
