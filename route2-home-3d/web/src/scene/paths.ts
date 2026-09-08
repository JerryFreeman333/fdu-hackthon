import * as THREE from 'three';
import type { PathItem, SceneMode } from '../types';

export interface PathVisual {
  item: PathItem;
  group: THREE.Group;
  /** 显示并开始行走动画 */
  show(): void;
  hide(): void;
  center(): THREE.Vector3;
}

/**
 * 动线可视化: 发光管道 + 沿线行走的小人(球) + 起终点标记。
 * 夜间动线整体呈青蓝色发光, 与暗环境对比强烈。
 */
export function createPathVisual(item: PathItem, mode: SceneMode, onUpdate: (cb: (dt: number, elapsed: number) => void) => void): PathVisual {
  const points = (mode === 'demo' ? item.demoPoints : item.realPoints)?.map(p => new THREE.Vector3(p[0], Math.max(p[1], 0.05), p[2]));
  const group = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3(points!, false, 'catmullrom', 0.35);
  const color = item.mode === 'night' ? 0x53d8ff : 0xffd166;

  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, Math.max(48, points!.length * 12), 0.045, 10),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 })
  );
  group.add(tube);

  // 起终点
  const mkCap = (p: THREE.Vector3, c: number, r: number) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), new THREE.MeshBasicMaterial({ color: c }));
    m.position.copy(p);
    return m;
  };
  const start = points![0];
  const end = points![points!.length - 1];
  group.add(mkCap(start, 0x6ee7a0, 0.09), mkCap(end, 0xff8f6b, 0.09));

  // 行走的"老人"(呼吸脉动小球)
  const walker = mkCap(start, item.mode === 'night' ? 0xbfefff : 0xffffff, 0.13);
  group.add(walker);

  let playing = false;
  let t = 0;
  const speed = 0.09;
  onUpdate(dt => {
    if (!playing) return;
    t = (t + dt * speed) % 1;
    walker.position.copy(curve.getPointAt(t));
    const pulse = 1 + 0.25 * Math.sin(t * Math.PI * 8);
    walker.scale.setScalar(pulse);
    (tube.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.3 * Math.sin(t * Math.PI * 2);
  });

  return {
    item,
    group,
    show() {
      playing = true;
      t = 0;
      group.visible = true;
    },
    hide() {
      playing = false;
      group.visible = false;
    },
    center() {
      const b = new THREE.Box3().setFromObject(group);
      return b.getCenter(new THREE.Vector3());
    }
  };
}

/** 高亮某条动线经过的危险点所在曲线段(红色覆盖) */
export function highlightDangerZones(item: PathItem, markersPos: Map<string, THREE.Vector3>, mode: SceneMode): THREE.Group | null {
  const points = (mode === 'demo' ? item.demoPoints : item.realPoints)?.map(p => new THREE.Vector3(p[0], Math.max(p[1], 0.05), p[2]));
  if (!points || points.length < 2) return null;
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.35);
  const group = new THREE.Group();
  const total = curve.getLength();
  const segLen = 0.9;

  for (const id of item.hazardIds) {
    const p = markersPos.get(id);
    if (!p) continue;
    // 找到曲线上离危险点最近的参数
    let bestU = 0;
    let bestD = Infinity;
    for (let i = 0; i <= 120; i++) {
      const u = i / 120;
      const d = curve.getPointAt(u).distanceTo(p);
      if (d < bestD) { bestD = d; bestU = u; }
    }
    const u0 = Math.max(0, bestU - segLen / total / 2);
    const u1 = Math.min(1, bestU + segLen / total / 2);
    if (u1 - u0 < 0.01) continue;
    const n = 14;
    const subPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) subPoints.push(curve.getPointAt(u0 + (u1 - u0) * (i / n)));
    const subCurve = new THREE.CatmullRomCurve3(subPoints);
    group.add(new THREE.Mesh(
      new THREE.TubeGeometry(subCurve, 20, 0.08, 10, false),
      new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.95 })
    ));
  }
  return group.children.length ? group : null;
}