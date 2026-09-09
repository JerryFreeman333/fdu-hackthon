import * as THREE from 'three';
import './style.css';
import type { HazardData, HazardItem, ItemInfo, PathItem, SceneMode } from './types';
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

const DEMO_SPLAT_URL = 'models/home.ply';
const ACTION_PLAN_URL = 'data/family-action-plan.json';
const RESCAN_ENDPOINT = import.meta.env.VITE_ROUTE2_API_URL ?? '/api/route2/rescan';

type RiskProjection = {
  schemaVersion: 1;
  type: 'person-home-risk-projection';
  status: 'non-diagnostic';
  privacyScope: 'private' | 'family_ok';
  risks: Array<{ id: string }>;
};

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
    setHint('演示模式：危险点、动线和物品均来自预置场景数据；真实模型需要完成空间标定。');
  } else {
    setHint('正在加载真实高斯泼溅模型…');
    await app.initReal(DEMO_SPLAT_URL);
    const realHazardCount = data.hazards.filter((h) => h.realPos).length;
    const realPathCount = data.paths.filter((p) => p.realPoints && p.realPoints.length >= 2).length;
    const realItemCount = data.items.filter((item) => item.realPos).length;
    setHint(`真实模型已加载 · 已标定危险点 ${realHazardCount}/${data.hazards.length} · 动线 ${realPathCount}/${data.paths.length} · 物品 ${realItemCount}/${data.items.length}`);
  }

  const markers = createHazardMarkers(data.hazards, mode, (cb) => app.onUpdate(cb));
  app.scene.add(markers.group);

  const rings = createItemRings((cb) => app.onUpdate(cb));
  app.scene.add(rings.group);

  const clickables = markers.objects;
  const domEl = () => (app as any).renderer?.domElement ?? (app as any).gsViewer?.renderer?.domElement;
  let downXY: [number, number] | null = null;
  window.addEventListener('pointerdown', (e) => {
    downXY = [e.clientX, e.clientY];
  });
  window.addEventListener('pointerup', (e) => {
    if (!downXY) return;
    const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]);
    downXY = null;
    if (moved > 6) return;
    if (e.target !== domEl()) return;
    const hit = app.pick(e.clientX, e.clientY, clickables)[0];
    if (!hit) return;
    const id = markers.idOf(hit.object);
    if (!id) return;
    const h = data.hazards.find((x) => x.id === id);
    if (h) openHazard(h);
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
  pathVisuals.forEach((v) => {
    v.group.visible = false;
    app.scene.add(v.group);
  });
  let dangerZones: THREE.Group | null = null;

  function selectPath(p: PathItem | null) {
    pathVisuals.forEach((v) => v.hide());
    dangerZones?.removeFromParent();
    dangerZones = null;
    hideHazardCard();
    if (!p) {
      app.setNight(false);
      markers.filter(null);
      setHint(mode === 'demo' ? '演示模式：危险点、动线和物品均来自预置场景数据。' : '真实模型已加载；请先完成路线标定。');
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
    p.hazardIds.forEach((id) => {
      const q = markers.positionOf(id);
      if (q) posMap.set(id, q);
    });
    const zones = highlightDangerZones(p, posMap, mode);
    if (zones) {
      dangerZones = zones;
      app.scene.add(zones);
    }
    const names = p.hazardIds.map((id) => data.hazards.find((h) => h.id === id)?.title).filter(Boolean).join('、');
    setHint(`${p.title} — 途经风险: ${names || '暂无已标注风险'}`);
    app.flyTo(v.center().clone().add(new THREE.Vector3(3.2, 3.4, 3.8)), v.center(), 1.6);
  }

  let panelController: { updateActionPlan(plan: HomeSafetyActionPlan | null): void };

  async function handleRescanFiles(files: File[]): Promise<void> {
    const input = prepareRescanFiles(files);
    if (!input) {
      setHint('没有识别到支持的 JPG/PNG/WebP/HEIC/HEIF 图片或 MP4/WebM/MOV/M4V 视频。');
      return;
    }
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
      if (result.status === 'failed') {
        throw new Error(result.message ?? '复扫处理失败');
      }
      if (result.actionPlan) {
        const parsed = parseHomeSafetyActionPlan(result.actionPlan);
        if (parsed) currentActionPlan = parsed;
      } else if (result.latestRiskIds && currentActionPlan) {
        currentActionPlan = applyRescan(currentActionPlan, result.latestRiskIds);
      }
      panelController.updateActionPlan(currentActionPlan);
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
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      void handleRescanFiles(files);
    });
    input.click();
  }

  panelController = initPanel(data, {
    onSelectHazard: openHazard,
    onSelectPath: selectPath,
    onSelectItem(item: ItemInfo) {
      const pos = mode === 'demo' ? item.demoPos : item.realPos;
      if (!pos) {
        setHint(`「${item.title}」尚未完成真实空间标定，当前不会伪造位置。`);
        return;
      }
      const p = new THREE.Vector3(pos[0], pos[1], pos[2]);
      rings.pulseAt(p, 0x53d8ff);
      app.flyTo(p.clone().add(new THREE.Vector3(1.0, 0.8, 1.0)), p.clone(), 1.3);
      setHint(`找到「${item.title}」: ${item.location} — ${item.say}`);
    },
    onRescan,
  }, mode, currentActionPlan);

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