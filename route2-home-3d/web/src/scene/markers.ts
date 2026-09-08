import * as THREE from 'three';
import type { HazardItem, RiskLevel, SceneMode } from '../types';

const LEVEL_COLOR: Record<RiskLevel, number> = {
  high: 0xe74c3c,
  medium: 0xf39c12,
  low: 0xf1c40f
};

function makeSprite(color: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  // 外圈
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fill();
  // 主体
  ctx.beginPath();
  ctx.arc(64, 64, 48, 0, Math.PI * 2);
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
  ctx.fill();
  // 感叹号
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(56, 30, 16, 46);
  ctx.beginPath();
  ctx.arc(64, 92, 10, 0, Math.PI * 2);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: true, transparent: true }));
  sprite.scale.setScalar(0.4);
  return sprite;
}

function makePulseRing(color: number): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.22, 0.3, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  return ring;
}

export interface HazardMarkers {
  group: THREE.Group;
  objects: THREE.Object3D[];
  /** 命中检测时使用的 id */
  idOf(obj: THREE.Object3D): string | null;
  /** 选中态: 标记放大 + 地面脉冲环 */
  setSelected(id: string | null): void;
  /** 只显示指定 id 集合的标记, null = 全部显示 */
  filter(ids: Set<string> | null): void;
  positionOf(id: string): THREE.Vector3 | null;
}

export function createHazardMarkers(hazards: HazardItem[], mode: SceneMode, onUpdate: (cb: (dt: number, elapsed: number) => void) => void): HazardMarkers {
  const group = new THREE.Group();
  const map = new Map<string, { sprite: THREE.Sprite; ring: THREE.Mesh; item: HazardItem }>();

  for (const h of hazards) {
    const pos = mode === 'demo' ? h.demoPos : h.realPos;
    if (!pos) continue;
    const sprite = makeSprite(LEVEL_COLOR[h.level]);
    sprite.position.set(pos[0], pos[1] + 0.55, pos[2]);
    const ring = makePulseRing(LEVEL_COLOR[h.level]);
    ring.position.set(pos[0], Math.max(pos[1] - 0.45, 0.02), pos[2]);
    ring.visible = false;
    group.add(sprite, ring);
    map.set(h.id, { sprite, ring, item: h });
  }

  // 脉冲动画
  onUpdate((_, elapsed) => {
    for (const { ring } of map.values()) {
      if (!ring.visible) continue;
      const s = 1 + 0.35 * Math.sin(elapsed * 4);
      ring.scale.setScalar(s);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.85 - 0.35 * Math.sin(elapsed * 4);
    }
  });

  return {
    group,
    objects: [...map.values()].map(v => v.sprite),
    idOf(obj) {
      for (const [id, v] of map) if (v.sprite === obj) return id;
      return null;
    },
    setSelected(id) {
      for (const [key, v] of map) {
        const on = key === id;
        v.ring.visible = on;
        v.sprite.scale.setScalar(on ? 0.55 : 0.4);
      }
    },
    filter(ids) {
      for (const [key, v] of map) v.sprite.visible = ids === null || ids.has(key);
    },
    positionOf(id) {
      const v = map.get(id);
      if (!v) return null;
      const p = v.sprite.position.clone();
      p.y -= 0.55;
      return p;
    }
  };
}

/** 物品高亮环(找东西) */
export interface ItemRings {
  group: THREE.Group;
  pulseAt(pos: THREE.Vector3, color: number): void;
}

export function createItemRings(onUpdate: (cb: (dt: number, elapsed: number) => void) => void): ItemRings {
  const group = new THREE.Group();
  let active: THREE.Mesh | null = null;
  onUpdate((_, elapsed) => {
    if (active) {
      const s = 1 + 0.5 * Math.sin(elapsed * 5);
      active.scale.setScalar(s);
    }
  });
  return {
    group,
    pulseAt(pos, color) {
      if (active) group.remove(active);
      active = makePulseRing(color);
      active.position.set(pos.x, pos.y + 0.03, pos.z);
      active.scale.setScalar(1);
      group.add(active);
    }
  };
}