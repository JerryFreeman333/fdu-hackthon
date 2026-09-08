import * as THREE from 'three';
import './style.css';
import type { HazardData, HazardItem, ItemInfo, PathItem, SceneMode } from './types';
import { SceneManager } from './scene/app';
import { buildDemoRoom } from './scene/demoRoom';
import { createHazardMarkers, createItemRings } from './scene/markers';
import { createPathVisual, highlightDangerZones } from './scene/paths';
import { initPanel, showHazardCard, hideHazardCard, setHint } from './ui/panel';

const DEMO_SPLAT_URL = 'models/home.ply';

async function hasRealModel(): Promise<boolean> {
  try {
    const res = await fetch(DEMO_SPLAT_URL, { method: 'HEAD' });
    return res.ok && (parseInt(res.headers.get('content-length') ?? '0', 10) > 1000);
  } catch {
    return false;
  }
}

async function main() {
  const data: HazardData = await (await fetch('data/hazards.json')).json();
  const mode: SceneMode = (await hasRealModel()) ? 'real' : 'demo';

  const badge = document.getElementById('scene-badge')!;
  badge.textContent = mode === 'real' ? '真实重建 · Gaussian Splatting' : '合成演示场景';
  badge.className = 'badge ' + (mode === 'real' ? 'badge-real' : 'badge-demo');

  const app = new SceneManager(mode);

  if (mode === 'demo') {
    const room = buildDemoRoom();
    app.scene.add(room.group);
    app.initDemo(on => room.setNight(on));
    setHint('演示场景: 左键旋转 / 滚轮缩放 / 右键平移 — 右侧面板体验三大功能');
  } else {
    setHint('正在加载高斯泼溅模型…');
    await app.initReal(DEMO_SPLAT_URL);
    setHint('真实模型加载完成 — 左侧功能面板可用; 标注坐标见 public/data/hazards.json 的 realPos');
  }

  // ---------- 危险点标记 ----------
  const markers = createHazardMarkers(data.hazards, mode, cb => app.onUpdate(cb));
  app.scene.add(markers.group);

  // ---------- 物品高亮 ----------
  const rings = createItemRings(cb => app.onUpdate(cb));
  app.scene.add(rings.group);

  // ---------- 点击拾取(3D 标记) ----------
  const clickables = markers.objects;
  const domEl = () => (app as any).renderer?.domElement ?? (app as any).gsViewer?.renderer?.domElement;
  let downXY: [number, number] | null = null;
  window.addEventListener('pointerdown', e => { downXY = [e.clientX, e.clientY]; });
  window.addEventListener('pointerup', e => {
    if (!downXY) return;
    const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]);
    downXY = null;
    if (moved > 6) return;                       // 拖拽不算点击
    if (e.target !== domEl()) return;
    const hit = app.pick(e.clientX, e.clientY, clickables)[0];
    if (hit) {
      const id = markers.idOf(hit.object);
      if (id) {
        const h = data.hazards.find(x => x.id === id)!;
        openHazard(h);
      }
    }
  });

  function openHazard(h: HazardItem) {
    markers.setSelected(h.id);
    showHazardCard(h, data.meta.levels);
    const p = markers.positionOf(h.id);
    if (p) app.flyTo(p.clone().add(new THREE.Vector3(1.4, 1.1, 1.4)), p.clone().add(new THREE.Vector3(0, 0.25, 0)), 1.2);
  }

  // ---------- 动线 ----------
  const pathVisuals = data.paths.map(p => createPathVisual(p, mode, cb => app.onUpdate(cb)));
  pathVisuals.forEach(v => { v.group.visible = false; app.scene.add(v.group); });
  let dangerZones: THREE.Group | null = null;

  function selectPath(p: PathItem | null) {
    pathVisuals.forEach(v => v.hide());
    dangerZones?.removeFromParent();
    dangerZones = null;
    hideHazardCard();
    if (!p) {
      app.setNight(false);
      markers.filter(null);
      setHint(mode === 'demo' ? '演示场景: 左键旋转 / 滚轮缩放 / 右键平移' : '真实模型已加载');
      return;
    }
    const v = pathVisuals.find(x => x.item.id === p.id)!;
    v.show();
    app.setNight(p.mode === 'night');
    // 只显示该动线相关的危险点
    markers.filter(new Set(p.hazardIds));
    const posMap = new Map<string, THREE.Vector3>();
    p.hazardIds.forEach(id => { const q = markers.positionOf(id); if (q) posMap.set(id, q); });
    const zones = highlightDangerZones(p, posMap, mode);
    if (zones) {
      dangerZones = zones;
      app.scene.add(zones);
    }
    const names = p.hazardIds.map(id => data.hazards.find(h => h.id === id)?.title).filter(Boolean).join('、');
    setHint(`${p.title} — 途经风险: ${names}`);
    app.flyTo(v.center().clone().add(new THREE.Vector3(3.2, 3.4, 3.8)), v.center(), 1.6);
  }

  // ---------- 面板 ----------
  initPanel(data, {
    onSelectHazard: openHazard,
    onSelectPath: selectPath,
    onSelectItem(item: ItemInfo) {
      const pos = mode === 'demo' ? item.demoPos : item.realPos;
      if (!pos) { setHint(`「${item.title}」尚未在真实模型中标注坐标`); return; }
      const p = new THREE.Vector3(pos[0], pos[1], pos[2]);
      rings.pulseAt(p, 0x53d8ff);
      app.flyTo(p.clone().add(new THREE.Vector3(1.0, 0.8, 1.0)), p.clone(), 1.3);
      setHint(`找到「${item.title}」: ${item.location} — ${item.say}`);
    }
  });

  // ---------- resize ----------
  window.addEventListener('resize', () => {
    app.camera.aspect = window.innerWidth / window.innerHeight;
    app.camera.updateProjectionMatrix();
    (app as any).renderer?.setSize(window.innerWidth, window.innerHeight);
  });
}

main().catch(err => {
  console.error(err);
  setHint('初始化失败: ' + (err instanceof Error ? err.message : String(err)));
});