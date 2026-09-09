import * as THREE from 'three';
import type { PathItem, SceneMode } from '../types';

export interface PathVisual {
  item: PathItem;
  group: THREE.Group;
  show(): void;
  hide(): void;
  center(): THREE.Vector3;
}

function resolvePoints(item: PathItem, mode: SceneMode): THREE.Vector3[] | null {
  const source = mode === 'demo' ? item.demoPoints : item.realPoints;
  if (!source || source.length < 2) return null;
  return source.map(p => new THREE.Vector3(p[0], Math.max(p[1], 0.05), p[2]));
}

export function createPathVisual(item: PathItem, mode: SceneMode, onUpdate: (cb: (dt: number, elapsed: number) => void) => void): PathVisual {
  const points = resolvePoints(item, mode);
  const group = new THREE.Group();
  group.userData.routeCalibrated = Boolean(points);
  if (!points) {
    return {
      item,
      group,
      show() { group.visible = false; },
      hide() { group.visible = false; },
      center() { return new THREE.Vector3(); }
    };
  }

  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.35);
  const color = item.mode === 'night' ? 0x53d8ff : 0xffd166;
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, Math.max(48, points.length * 12), 0.045, 10),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 })
  );
  group.add(tube);

  const mkCap = (p: THREE.Vector3, c: number, r: number) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), new THREE.MeshBasicMaterial({ color: c }));
    m.position.copy(p);
    return m;
  };
  group.add(mkCap(points[0], 0x6ee7a0, 0.09), mkCap(points[points.length - 1], 0xff8f6b, 0.09));

  const walker = mkCap(points[0], item.mode === 'night' ? 0xbfefff : 0xffffff, 0.13);
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

export function highlightDangerZones(item: PathItem, markersPos: Map<string, THREE.Vector3>, mode: SceneMode): THREE.Group | null {
  const points = resolvePoints(item, mode);
  if (!points || points.length < 2) return null;
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.35);
  const group = new THREE.Group();
  const total = curve.getLength();
  if (!Number.isFinite(total) || total <= 0) return null;
  const segLen = 0.9;

  for (const id of item.hazardIds) {
    const p = markersPos.get(id);
    if (!p) continue;
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
    const subPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= 14; i++) subPoints.push(curve.getPointAt(u0 + (u1 - u0) * (i / 14)));
    const subCurve = new THREE.CatmullRomCurve3(subPoints);
    group.add(new THREE.Mesh(
      new THREE.TubeGeometry(subCurve, 20, 0.08, 10, false),
      new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.95 })
    ));
  }
  return group.children.length ? group : null;
}