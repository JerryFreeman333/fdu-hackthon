import * as THREE from 'three';
import './style.css';
import type { HazardData, HazardItem, ItemInfo, SceneMode } from './types';
import { buildDemoHomeTwin } from './hometwin/fromHazardData';
import { validateHomeTwin } from './hometwin/model';
import { applyRescan, parseHomeSafetyActionPlan, type HomeSafetyActionPlan } from './hometwin/actionPlan';
import { prepareRescanFiles, revokeRescanPreview, type RescanInputResult } from './hometwin/rescanInput';
import { submitRescanBatch, waitForRescanJob, type RescanSubmitResponse } from './hometwin/rescanClient';
import { SceneManager } from './scene/app';
import { buildDemoRoom } from './scene/demoRoom';
import { createHazardMarkers, createItemRings } from './scene/markers';
import { createPathVisual, highlightDangerZones } from './scene/paths';
import { initPanel, showHazardCard, hideHazardCard, setHint } from './ui/panel';
import { createRoleSwitcher, readStoredRole, updateRoleSwitcher, type Route2Role } from './ui/roleMode';
import { buildJourney, type JourneyStep } from './ui/journey';

const DEMO_SPLAT_URL = 'models/home.ply';
const ACTION_PLAN_URL = 'data/family-action-plan.json';
const RESCAN_ENDPOINT = import.meta.env.VITE_ROUTE2_API_URL ?? '/api/route2/rescan';

async function hasRealModel(): Promise<boolean> {
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

function renderJourney(role: Route2Role, hasModel: boolean, mount: HTMLElement, onAction: (stepId: string) => void): void {
  mount.innerHTML = '';
  const steps = buildJourney(role, hasModel);
  const header = document.createElement('div');
  header.className = 'journey-header';
  header.innerHTML = `<b>${role === 'resident' ? '今天怎么用' : '家庭使用流程'}</b><span>${hasModel ? '家庭空间已建立' : '首次建立家庭空间'}</span>`;
  mount.append(header);

  const list = document.createElement('div');
  list.className = 'journey-steps';
  steps.forEach((step: JourneyStep, index) => {
    const item = document.createElement('button');
    item.className = `journey-step journey-${step.state}`;
    item.dataset.stepId = step.id;
    item.type = 'button';
    item.innerHTML = `<span class="journey-index">${index + 1}</span><span><b>${step.title}</b><small>${step.description}</small></span>`;
    item.onclick = () => onAction(step.id);
    list.append(item);
  });
  mount.append(list);
}

async function main() {
  const dataResponse = await fetch('data/hazards.json');
  if (!dataResponse.ok) throw new Error(`无法读取场景数据: HTTP ${dataResponse.status}`);
  const data = (await dataResponse.json()) as HazardData;
  const mode: SceneMode = (await hasRealModel()) ? 'real' : 'demo';
  const actionPlan = parseHomeSafetyActionPlan(await loadJson(ACTION_PLAN_URL));
  let currentActionPlan: HomeSafetyActionPlan | null = actionPlan;
  let lastRescanInput: RescanInputResult | null = null;

  const badge = document.getElementById('scene-badge')!;
  badge.textContent = mode === 'real' ? '真实重建 · Gaussian Splatting' : '合成演示场景 · 预置数据';
  badge.className = 'badge ' + (mode === 'real' ? 'badge-real' : 'badge-demo');

  if (mode === 'demo') {
    const snapshot = buildDemoHomeTwin(data);
    const errors = validateHomeTwin(snapshot);
    if (errors.length) throw new Error(`Home Twin 数据校验失败: ${errors.join('; ')}`);
  }

  const app = new SceneManager(mode);
  if (mode === 'demo') {
    const room = buildDemoRoom();
    app.scene.add(room.group);
    app.initDemo((on) => room.setNight(on));
  } else {
    setHint('正在加载真实高斯泼溅模型…');
    await app.initReal(DEMO_SPLAT_URL);
  }

  const markers = createHazardMarkers(data.hazards, mode, (cb) => app.onUpdate(cb));
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
    const hazard = data.hazards.find((x) => x.id === id);
    if (hazard) openHazard(hazard);
  });

  function openHazard(h: HazardItem) {
    markers.setSelected(h.id);
    showHazardCard(h, data.meta.levels);
    const p = markers.positionOf(h.id);
    if (p) app.flyTo(p.clone().add(new THREE.Vector3(1.4, 1.1, 1.4)), p.clone().add(new THREE.Vector3(0, 0.25, 0)), 1.2);
  }

  const pathVisuals = data.paths
    .filter((p) => mode === 'demo' || (p.realPoints && p.realPoints.length >= 2))
    .map((p) => createPathVisual(p, mode, (cb) => app.onUpdate(cb)));
  pathVisuals.forEach((v) => { v.group.visible = false; app.scene.add(v.group); });
  let dangerZones: THREE.Group | null = null;

  function selectPath(p: any | null) {
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
    const names = p.hazardIds.map((id: string) => data.hazards.find((h) => h.id === id)?.title).filter(Boolean).join('、');
    setHint(`${p.title} — 影响风险: ${names || '暂无已标注风险'}`);
    app.flyTo(v.center().clone().add(new THREE.Vector3(3.2, 3.4, 3.8)), v.center(), 1.6);
  }

  let panelController: { updateActionPlan(plan: HomeSafetyActionPlan | null): void; setRole(nextRole: Route2Role): void; };
  let currentRole = readStoredRole();
  const journeyMount = document.getElementById('journey');

  function refreshJourney(): void {
    if (!journeyMount) return;
    renderJourney(currentRole, true, journeyMount, (stepId) => {
      if (stepId === 'find') document.querySelector<HTMLButtonElement>('[data-role-tab="find"]')?.click();
      else if (stepId === 'review') document.querySelector<HTMLButtonElement>('[data-role-tab="family-hazards"]')?.click();
      else if (stepId === 'act') document.querySelector<HTMLButtonElement>('[data-role-tab="family-home"]')?.click();
      else if (stepId === 'return') setHint('后续只需回来查看变化和待处理事项，不需要重新学习整套系统。');
      else if (stepId === 'create') setHint(mode === 'demo' ? '当前 Demo 已预载家庭空间；真实产品中这里由子女完成一次家庭采集。' : '请先完成一次家庭空间采集。');
      else if (stepId === 'home-ready') setHint('家庭空间已建立，可以直接使用找东西。');
      else if (stepId === 'help') setHint('需要复杂处理时，系统会把事项交给家人/照护者。');
    });
  }
  refreshJourney();

  const roleMount = document.getElementById('role-switcher');
  const roleSwitcher = roleMount ? createRoleSwitcher(currentRole, (nextRole) => {
    currentRole = nextRole;
    updateRoleSwitcher(roleSwitcher, nextRole);
    panelController.setRole(nextRole);
    refreshJourney();
    setHint(nextRole === 'resident' ? '居住者视角：完成日常任务即可。' : '家属/照护者视角：查看变化、风险和处理任务。');
  }) : null;
  if (roleMount && roleSwitcher) roleMount.replaceChildren(roleSwitcher);

  async function handleRescanFiles(files: File[]): Promise<void> {
    const input = prepareRescanFiles(files);
    if (!input) { setHint('没有识别到支持的图片或视频。'); return; }
    lastRescanInput = input;
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
      if (result.actionPlan) { const parsed = parseHomeSafetyActionPlan(result.actionPlan); if (parsed) currentActionPlan = parsed; }
      else if (result.latestRiskIds && currentActionPlan) currentActionPlan = applyRescan(currentActionPlan, result.latestRiskIds);
      panelController.updateActionPlan(currentActionPlan);
      refreshJourney();
      setHint(result.message ?? `复扫完成：${batch.files.length} 个文件已由 Home Twin 处理。`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setHint(`${detail}；本次复扫未改变现有风险/行动状态。`);
    } finally {
      revokeRescanPreview(lastRescanInput);
      lastRescanInput = null;
    }
  }

  function onRescan(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/webm,video/quicktime,video/x-m4v';
    input.multiple = true;
    input.style.display = 'none';
    document.body.append(input);
    input.addEventListener('change', () => { const files = Array.from(input.files ?? []); input.remove(); void handleRescanFiles(files); });
    input.click();
  }

  panelController = initPanel(data, {
    onSelectHazard: openHazard,
    onSelectPath: selectPath,
    onSelectItem(item: ItemInfo) {
      const pos = mode === 'demo' ? item.demoPos : item.realPos;
      if (!pos) { setHint(`「${item.title}」尚未完成真实空间标定，当前不会伪造位置。`); return; }
      const p = new THREE.Vector3(pos[0], pos[1], pos[2]);
      rings.pulseAt(p, 0x53d8ff);
      app.flyTo(p.clone().add(new THREE.Vector3(1.0, 0.8, 1.0)), p.clone(), 1.3);
      setHint(`找到「${item.title}」: ${item.location} — ${item.say}`);
    },
    onRescan,
  }, mode, currentActionPlan, currentRole);

  window.addEventListener('resize', () => {
    app.camera.aspect = window.innerWidth / window.innerHeight;
    app.camera.updateProjectionMatrix();
    (app as any).renderer?.setSize(window.innerWidth, window.innerHeight);
  });
}

main().catch((err) => {
  console.error(err);
  const message = err instanceof Error ? err.message : String(err);
  setHint('初始化失败: ' + message);
});
