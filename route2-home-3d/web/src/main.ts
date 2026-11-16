import * as THREE from 'three';
import './style.css';
import type { HazardData, HazardItem, ItemInfo, SceneMode } from './types';
import { buildDemoHomeTwin } from './hometwin/fromHazardData';
import { validateHomeTwin, type HomeTwinSnapshot, type RouteStatus } from './hometwin/model';
import { planBedToToilet, type RoutePlanResult } from './hometwin/routePlanner';
import {
  fetchCaptureHome,
  itemsFromSnapshot,
  loadSemanticSnapshot,
  type CaptureHomeSummary
} from './hometwin/semanticSnapshot';
import { acceptRescanActionPlan, parseHomeSafetyActionPlan, type HomeSafetyActionPlan } from './hometwin/actionPlan';
import { prepareRescanFiles, revokeRescanPreview, type RescanInputResult } from './hometwin/rescanInput';
import { submitRescanBatch, waitForRescanJob, checkRescanService, type RescanSubmitResponse } from './hometwin/rescanClient';
import { SceneManager } from './scene/app';
import { buildDemoRoom } from './scene/demoRoom';
import { createHazardMarkers, createItemRings } from './scene/markers';
import { createPathVisual, highlightDangerZones } from './scene/paths';
import { initPanel, showHazardCard, hideHazardCard, setHint } from './ui/panel';
import { createRoleSwitcher, readStoredRole, hasStoredRole, updateRoleSwitcher, type Route2Role } from './ui/roleMode';
import { buildJourney, type JourneyStep } from './ui/journey';
import { escapeHtml } from './ui/dom';
import { buildItemSpeech, speakGuide } from './ui/speech';

const DEMO_SPLAT_URL = 'models/home.ply';
const ACTION_PLAN_URL = 'data/family-action-plan.json';
const RESCAN_ENDPOINT = import.meta.env.VITE_ROUTE2_API_URL ?? '/api/route2/rescan';

async function hasRealModel(): Promise<boolean> {
  // Explicit sample mode must never mix a locally exported real room with
  // pre-populated hazards/medication positions belonging to the demo household.
  if (new URLSearchParams(window.location.search).get('demo') === '1') return false;
  try {
    const res = await fetch(DEMO_SPLAT_URL, { method: 'HEAD' });
    if (!res.ok) return false;
    const length = Number.parseInt(res.headers.get('content-length') ?? '0', 10);
    return Number.isFinite(length) && length > 1000;
  } catch {
    return false;
  }
}

async function loadJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function renderJourney(role: Route2Role, mode: SceneMode, mount: HTMLElement, onAction: (stepId: string) => void): void {
  mount.innerHTML = '';
  const hasModel = mode === 'real';
  const steps = buildJourney(role, hasModel);
  const header = document.createElement('div');
  header.className = 'journey-header';
  // Demo 场景有预置房间，但没有真实家庭采集；不能显示“家庭空间已建立”。
  header.innerHTML = `<b>${role === 'resident' ? '今天怎么用' : '家庭使用流程'}</b><span>${
    hasModel ? '家庭空间已建立' : mode === 'demo' ? '合成演示场景 · 未建立真实家庭空间' : '首次建立家庭空间'
  }</span>`;
  mount.append(header);

  const list = document.createElement('div');
  list.className = 'journey-steps';
  steps.forEach((step: JourneyStep, index) => {
    const item = document.createElement('button');
    item.className = `journey-step journey-${step.state}`;
    item.dataset.stepId = step.id;
    item.type = 'button';
    item.innerHTML = `<span class="journey-index">${index + 1}</span><span><b>${escapeHtml(step.title)}</b><small>${escapeHtml(step.description)}</small></span>`;
    item.onclick = () => onAction(step.id);
    list.append(item);
  });
  mount.append(list);
}

async function main() {
  const dataResponse = await fetch('data/hazards.json');
  if (!dataResponse.ok) throw new Error(`无法读取场景数据: HTTP ${dataResponse.status}`);
  const data = (await dataResponse.json()) as HazardData;

  // ?home=<id>：从拍摄流程带回真实的家庭空间，而不是永远落在预置演示数据上。
  const params = new URLSearchParams(window.location.search);
  const requestedHomeId = params.get('home');
  const capturedHome: CaptureHomeSummary | null = requestedHomeId ? await fetchCaptureHome(requestedHomeId) : null;
  const capturedModelUrl = capturedHome?.modelReady && capturedHome.modelUrl ? capturedHome.modelUrl : null;
  const mode: SceneMode = capturedModelUrl ? 'real' : (await hasRealModel()) ? 'real' : 'demo';

  // 预置风险/行动基线属于演示家庭。真实拍摄的家庭空间没有人工确认过的风险清单，
  // 不能把演示风险画到别人家里；宁可为空并如实说明。
  const actionPlan = parseHomeSafetyActionPlan(capturedModelUrl ? null : await loadJson(ACTION_PLAN_URL));
  let currentActionPlan: HomeSafetyActionPlan | null = actionPlan;
  let lastRescanInput: RescanInputResult | null = null;
  let rescanInFlight = false;
  let hasUserSelection = false;

  let homeTwin: HomeTwinSnapshot | null = null;
  let routePlan: RoutePlanResult | null = null;
  let panelData: HazardData = data;

  const badge = document.getElementById('scene-badge')!;
  badge.textContent = capturedModelUrl
    ? '你的家庭空间 · Gaussian Splatting'
    : mode === 'real'
      ? '真实重建 · Gaussian Splatting'
      : '合成演示场景 · 预置数据';
  badge.className = 'badge ' + (mode === 'real' ? 'badge-real' : 'badge-demo');

  if (mode === 'demo') {
    homeTwin = buildDemoHomeTwin(data);
    const errors = validateHomeTwin(homeTwin);
    if (errors.length) throw new Error(`Home Twin 数据校验失败: ${errors.join('; ')}`);
    routePlan = planBedToToilet(homeTwin);
  } else if (capturedModelUrl) {
    const semantic = await loadSemanticSnapshot(capturedHome);
    if (semantic.snapshot) {
      homeTwin = semantic.snapshot;
      routePlan = planBedToToilet(homeTwin);
      panelData = {
        meta: {
          note: '物品位置来自本次拍摄的视觉识别结果（COLMAP 任意坐标系，未做米制标定）。这里只展示有画面证据的识别结果；风险与路线仍需人工确认。',
          levels: data.meta.levels,
          provenance: 'vision',
          capturedAt: capturedHome?.capturedAt,
          scaleConfidence: 0
        },
        hazards: [],
        paths: [],
        items: itemsFromSnapshot(homeTwin).map(item => ({ ...item, realPos: null }))
      };
    } else {
      // 失败也要说清楚失败在哪一步，不能退回演示物品清单冒充识别结果。
      panelData = {
        meta: {
          note: `本次没有可用的视觉识别结果：${semantic.errors.join('；') || '未生成'}。房间外观仍可查看，但不会显示猜测的物品位置。`,
          levels: data.meta.levels,
          provenance: 'vision',
          capturedAt: capturedHome?.capturedAt,
          scaleConfidence: 0
        },
        hazards: [],
        paths: [],
        items: []
      };
    }
  }

  const app = new SceneManager(mode);
  if (mode === 'demo') {
    const room = buildDemoRoom();
    app.scene.add(room.group);
    app.initDemo((on) => room.setNight(on));
  } else {
    setHint('正在加载真实高斯泼溅模型…');
    await app.initReal(capturedModelUrl ?? DEMO_SPLAT_URL);
  }

  const markers = createHazardMarkers(panelData.hazards, mode, (cb) => app.onUpdate(cb));
  app.scene.add(markers.group);
  const rings = createItemRings((cb) => app.onUpdate(cb));
  app.scene.add(rings.group);

  const clickables = markers.objects;
  const domEl = () => (app as any).renderer?.domElement ?? (app as any).gsViewer?.renderer?.domElement;
  let downXY: [number, number] | null = null;
  window.addEventListener('pointerdown', (e) => { downXY = [e.clientX, e.clientY]; });
  window.addEventListener('pointerup', (e) => {
    if (!downXY) return;
    const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]);
    downXY = null;
    if (moved > 6 || e.target !== domEl()) return;
    const hit = app.pick(e.clientX, e.clientY, clickables)[0];
    if (!hit) return;
    const id = markers.idOf(hit.object);
    if (!id) return;
    const hazard = panelData.hazards.find((x) => x.id === id);
    if (hazard) openHazard(hazard);
  });

  function openHazard(h: HazardItem) {
    hasUserSelection = true;
    markers.setSelected(h.id);
    showHazardCard(h, panelData.meta.levels);
    const p = markers.positionOf(h.id);
    if (p) app.flyTo(p.clone().add(new THREE.Vector3(1.4, 1.1, 1.4)), p.clone().add(new THREE.Vector3(0, 0.25, 0)), 1.2);
  }

  const pathVisuals = panelData.paths
    .filter((p) => mode === 'demo' || (p.realPoints && p.realPoints.length >= 2))
    .map((p) => createPathVisual(p, mode, (cb) => app.onUpdate(cb)));
  pathVisuals.forEach((v) => { v.group.visible = false; app.scene.add(v.group); });
  let dangerZones: THREE.Group | null = null;

  function selectPath(p: any | null) {
    if (p) hasUserSelection = true;
    pathVisuals.forEach((v) => v.hide());
    dangerZones?.removeFromParent();
    dangerZones = null;
    hideHazardCard();
    if (!p) {
      app.setNight(false);
      markers.filter(null);
      setHint(mode === 'demo' ? '演示模式：路线仅用于解释风险影响范围。' : '真实模型已加载；请先完成路线标定。');
      return;
    }
    const v = pathVisuals.find((x) => x.item.id === p.id);
    if (!v) {
      setHint(`「${p.title}」尚未完成真实空间标定，当前不会伪造路线。`);
      return;
    }
    v.show();
    app.setNight(p.mode === 'night');
    markers.filter(new Set(p.hazardIds));
    const posMap = new Map<string, THREE.Vector3>();
    p.hazardIds.forEach((id: string) => { const q = markers.positionOf(id); if (q) posMap.set(id, q); });
    const zones = highlightDangerZones(p, posMap, mode);
    if (zones) { dangerZones = zones; app.scene.add(zones); }
    const names = p.hazardIds
      .map((id: string) => panelData.hazards.find((h) => h.id === id)?.title)
      .filter(Boolean)
      .join('、');
    setHint(`${p.title} — 影响风险: ${names || '暂无已标注风险'}` + routeStatusSuffix());
    app.flyTo(v.center().clone().add(new THREE.Vector3(3.2, 3.4, 3.8)), v.center(), 1.6);
  }

  let panelController: { updateActionPlan(plan: HomeSafetyActionPlan | null): void; setRole(nextRole: Route2Role): void; setRescanOffline(offline: boolean): void; };
  let rescanOffline = true; // 默认按“未启动”处理，启动探测成功后才放开。
  let currentRole = readStoredRole();
  const journeyMount = document.getElementById('journey');

  const ROUTE_STATUS_TEXT: Record<RouteStatus, string> = {
    verified: '路线已确认',
    candidate: '候选路线（系统推导，非安全保证）',
    needs_confirmation: '路线待确认（缺少门/连接关系）',
    unavailable: '暂无可用 3D 路线'
  };
  function routeStatusSuffix(): string {
    if (!routePlan) return '';
    const text = ROUTE_STATUS_TEXT[routePlan.status];
    const fallbackNote = routePlan.fallback?.locationText ? `；参考位置：${routePlan.fallback.locationText}` : '';
    return ` — ${text}${fallbackNote}`;
  }

  function refreshJourney(): void {
    if (!journeyMount) return;
    renderJourney(currentRole, mode, journeyMount, (stepId) => {
      if (stepId === 'find') document.querySelector<HTMLButtonElement>('[data-role-tab="find"]')?.click();
      else if (stepId === 'review') document.querySelector<HTMLButtonElement>('[data-role-tab="family-hazards"]')?.click();
      else if (stepId === 'act') document.querySelector<HTMLButtonElement>('[data-role-tab="family-home"]')?.click();
      else if (stepId === 'return') setHint('后续只需回来查看变化和待处理事项，不需要重新学习整套系统。');
      else if (stepId === 'create') setHint(mode === 'demo' ? '当前 Demo 已预载家庭空间；真实产品中这里由子女完成一次家庭采集。' : '请先完成一次家庭空间采集。');
      else if (stepId === 'home-ready')
        setHint(
          mode === 'real'
            ? '家庭空间已建立，可以直接使用找东西。'
            : '当前是合成演示场景，还没有真实家庭空间；找东西使用的是预置位置。',
        );
      else if (stepId === 'help') setHint('需要复杂处理时，系统会把事项交给家人/照护者。');
    });
  }
  refreshJourney();

  const roleMount = document.getElementById('role-switcher');
  let roleSwitcherEl: HTMLElement | null = null;
  const roleSwitcher = roleMount ? createRoleSwitcher(currentRole, (nextRole) => {
    currentRole = nextRole;
    if (roleSwitcherEl) updateRoleSwitcher(roleSwitcherEl, nextRole);
    panelController.setRole(nextRole);
    refreshJourney();
    setHint(nextRole === 'resident' ? '居住者视角：完成日常任务即可。' : '家属/照护者视角：查看变化、风险和处理任务。');
  }) : null;
  if (roleMount && roleSwitcher) { roleSwitcherEl = roleSwitcher; roleMount.replaceChildren(roleSwitcher); }

  async function handleRescanFiles(files: File[]): Promise<void> {
    if (rescanInFlight) { setHint('正在处理上一轮复扫，请等待完成。'); return; }
    const input = prepareRescanFiles(files);
    if (!input) { setHint('没有识别到支持的图片或视频。'); return; }
    lastRescanInput = input;
    rescanInFlight = true;
    const batch = input.batch;
    setHint(`已选择 ${batch.files.length} 个复扫文件。正在提交到 Home Twin…`);
    try {
      let result: RescanSubmitResponse = await submitRescanBatch(batch, files, { endpoint: RESCAN_ENDPOINT });
      if (result.status === 'queued' || result.status === 'processing') {
        setHint(`复扫已排队：${result.jobId ?? batch.id}。正在等待新的空间证据…`);
        if (!result.jobId) throw new Error('复扫服务未返回 jobId');
        result = await waitForRescanJob(result.jobId, { endpoint: RESCAN_ENDPOINT, maxAttempts: 90, intervalMs: 1000 });
      }
      if (result.status === 'failed') throw new Error(result.message ?? '复扫处理失败');
      if (result.actionPlan) {
        if (!currentActionPlan) throw new Error('缺少当前家庭行动基线，不能接受自动关闭结果');
        const acceptance = acceptRescanActionPlan(currentActionPlan, result.actionPlan);
        if (!acceptance.accepted) throw new Error(acceptance.reason);
        currentActionPlan = result.actionPlan;
      } else if (result.latestRiskIds) {
        throw new Error('复扫仅返回风险编号，缺少新采集和重建证据');
      }
      panelController.updateActionPlan(currentActionPlan);
      refreshJourney();
      setHint(result.message ?? `复扫完成：${batch.files.length} 个文件已由 Home Twin 处理。`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setHint(`${detail}；本次复扫未改变现有风险/行动状态。`);
    } finally {
      revokeRescanPreview(lastRescanInput);
      lastRescanInput = null;
      rescanInFlight = false;
    }
  }

  async function onRescan(): Promise<void> {
    // 先探测后端；服务不在线时绝不弹文件选择框，避免家属选完文件才石沉大海。
    const status = await checkRescanService(RESCAN_ENDPOINT);
    if (!status.online) {
      rescanOffline = true;
      panelController.setRescanOffline(true);
      setHint('复扫服务未启动：请先在仓库根目录运行 python -m uvicorn backend.app:app --port 8010，再重新扫描。本次未选择文件，未改变任何状态。');
      return;
    }
    rescanOffline = false;
    panelController.setRescanOffline(false);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/webm,video/quicktime,video/x-m4v';
    input.multiple = true;
    input.style.display = 'none';
    document.body.append(input);
    input.addEventListener('change', () => { const files = Array.from(input.files ?? []); input.remove(); void handleRescanFiles(files); });
    input.click();
  }

  function selectItem(item: ItemInfo): void {
    hasUserSelection = true;
    const pos = mode === 'demo' ? item.demoPos : item.realPos;
    if (!pos) {
      setHint(`「${item.title}」: ${item.location} — ${item.say} 位置未做 3D 标定，以上文字仅供参考；如不确定，可让系统请家人确认。`);
      return;
    }
    const p = new THREE.Vector3(pos[0], pos[1], pos[2]);
    rings.pulseAt(p, 0x53d8ff);
    app.flyTo(p.clone().add(new THREE.Vector3(1.0, 0.8, 1.0)), p.clone(), 1.3);
    const guide = `找到「${item.title}」: ${item.location} — ${item.say}`;
    setHint(guide);
    // README 已声明“语音指引”；此前只有相机飞行和文字。不支持 TTS 时静默降级。
    speakGuide(buildItemSpeech(item));
  }

  panelController = initPanel(panelData, {
    onSelectHazard: openHazard,
    onSelectPath: selectPath,
    onSelectItem: selectItem,
    onRescan,
  }, mode, currentActionPlan, currentRole, { rescanOffline });

  // 真实家庭空间的路线状态必须主动说出来：算出了 candidate / needs_confirmation 却
  // 只在用户点开某条路径时才显示，等于让"路线已就绪"变成默认假设。
  if (capturedModelUrl) {
    if (routePlan) {
      const reason = routePlan.reason ? ` — ${routePlan.reason}` : '';
      const fallback = routePlan.fallback?.locationText ? `；参考位置：${routePlan.fallback.locationText}` : '';
      setHint(`已加载你的家庭空间。床→卫生间：${ROUTE_STATUS_TEXT[routePlan.status]}${reason}${fallback}`);
    } else {
      setHint('已加载你的家庭空间，但本次没有可用的视觉识别结果：房间外观可查看，找东西与路线暂不可用，不会显示猜测的位置。');
    }
  }

  // 启动即探测复扫服务：不在线时在复扫入口常驻提示，而不是等用户选完文件才失败。
  void checkRescanService(RESCAN_ENDPOINT).then((status) => {
    rescanOffline = !status.online;
    panelController.setRescanOffline(rescanOffline);
    // The async service probe is lower priority than a find/route result.
    if (hasUserSelection || capturedModelUrl) return;
    if (rescanOffline) {
      setHint('复扫服务未启动：家属端「重新扫描确认」暂不可用。启动方式：python -m uvicorn backend.app:app --port 8010。找东西等功能不受影响。');
    } else if (!hasStoredRole()) {
      setHint('首次使用：可在右上角切换「我是老人 / 我是子女」视角；老人日常只需要「找东西」页。');
    }
  });

  const requestedItemId = new URLSearchParams(window.location.search).get('find');
  const requestedItem = requestedItemId ? panelData.items.find((item) => item.id === requestedItemId) : undefined;
  if (requestedItem) {
    currentRole = 'resident';
    if (roleSwitcherEl) updateRoleSwitcher(roleSwitcherEl, currentRole);
    panelController.setRole(currentRole);
    refreshJourney();
    document.querySelector<HTMLButtonElement>('[data-role-tab="find"]')?.click();
    selectItem(requestedItem);
  }

  window.addEventListener('resize', () => {
    app.camera.aspect = window.innerWidth / window.innerHeight;
    app.camera.updateProjectionMatrix();
    (app as any).renderer?.setSize(window.innerWidth, window.innerHeight);
  });
}

const entryParams = new URLSearchParams(window.location.search);
// ?home=<id> 是拍摄完成后回到主场景的入口；?demo=1 是合成演示入口。
// 两者都没有时才进入拍摄页——否则拍完的人会被送回拍摄页，永远看不到识别结果。
(entryParams.get('demo') === '1' || entryParams.get('home')
  ? main()
  : import('./captureHome').then(module => module.captureHome())).catch((err) => {
  console.error(err);
  const message = err instanceof Error ? err.message : String(err);
  setHint('初始化失败: ' + message);
});
