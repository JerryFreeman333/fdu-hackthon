import * as THREE from 'three';

/**
 * 合成演示场景: 一套「卧室 + 走廊 + 客厅 + 卫生间」的老年家庭布局。
 * 坐标与 public/data/hazards.json 中的 demoPos 对齐（单位: 米, y 向上）。
 * 真实高斯模型就绪后自动切换, 此场景仅用于无模型时的功能演示。
 */
export interface DemoRoom {
  group: THREE.Group;
  setNight(on: boolean): void;
}

export function buildDemoRoom(): DemoRoom {
  const group = new THREE.Group();

  const mat = (color: number, rough = 0.9, metal = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  // ---------- 地板与墙 ----------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(11, 9), mat(0xb08968, 0.85));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(-0.5, 0, 0.25);
  floor.receiveShadow = true;
  group.add(floor);

  const wallMat = mat(0xe8e0d4, 0.95);
  box(11, 2.8, 0.15, wallMat, -0.5, 0, -3.6);          // 后墙
  box(0.15, 2.8, 9, wallMat, -6.1, 0, 0.25);           // 左墙
  box(0.15, 2.8, 9, wallMat, 5.1, 0, 0.25);            // 右墙
  box(3.2, 2.8, 0.15, wallMat, 1.2, 0, 4.1);           // 前墙(客厅段, 留出大门开口)
  box(2.6, 2.8, 0.15, wallMat, -4.6, 0, 4.1);          // 前墙(卧室段)

  // 大门(逃生出口)
  const door = box(0.1, 2.1, 1.1, mat(0x6b4f3a), 3.55, 0, 4.05);
  door.rotation.y = 0.35;
  const exitTag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.8, 0.3),
    new THREE.MeshBasicMaterial({ color: 0x2ecc71 })
  );
  exitTag.position.set(3.55, 2.35, 3.95);
  group.add(exitTag);

  // ---------- 卧室区 (x: -5 ~ -1.5) ----------
  box(2.2, 0.5, 1.7, mat(0xd8d2c8), -3.2, 0, -1.2);    // 床垫
  box(2.2, 0.75, 0.18, mat(0x6b4f3a), -3.2, 0.5, -2.1); // 床头板
  box(1.8, 0.16, 1.4, mat(0x7f9db9, 0.7), -3.2, 0.5, -1.15); // 被子
  box(0.5, 0.55, 0.5, mat(0x9a7b5f), -4.05, 0, -1.35); // 床头柜1
  box(0.5, 0.55, 0.5, mat(0x9a7b5f), -3.9, 0, -0.85);  // 床头柜2
  // 柜上的眼镜与药盒(找东西目标, 小物件)
  const glasses = box(0.16, 0.03, 0.06, mat(0x222222, 0.4), -4.0, 0.55, -1.3);
  glasses.name = 'item-glasses';
  const pillBox = box(0.14, 0.05, 0.1, mat(0xe67e22, 0.5), -3.9, 0.55, -0.9);
  pillBox.name = 'item-medicine';
  // 卧室衣柜
  box(1.6, 2.0, 0.6, mat(0x8a6f52), -5.2, 0, 1.6);

  // ---------- 地毯(翘边) : 卧室门口 -> 走廊 ----------
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.25), mat(0xa55a4a, 1));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(-0.6, 0.012, 0.2);
  rug.receiveShadow = true;
  group.add(rug);
  // 翘起的一角(楔形斜面)
  const curl = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.09, 0.5), mat(0x8f4638, 1));
  curl.position.set(-1.05, 0.045, 0.62);
  curl.rotation.set(0.18, 0, 0.3);
  curl.castShadow = true;
  group.add(curl);

  // ---------- 客厅区 (x: 1 ~ 5) ----------
  // 沙发
  box(2.0, 0.45, 0.85, mat(0x4a6b5d, 0.8), 2.2, 0, 1.7);
  box(2.0, 0.55, 0.25, mat(0x416050, 0.8), 2.2, 0.45, 2.0);
  box(0.25, 0.35, 0.85, mat(0x416050, 0.8), 3.08, 0.45, 1.7);
  box(0.25, 0.35, 0.85, mat(0x416050, 0.8), 1.32, 0.45, 1.7);
  // 茶几 + 钥匙
  box(0.95, 0.08, 0.55, mat(0x8a6f52, 0.5), 2.6, 0.34, 0.45);
  box(0.08, 0.34, 0.08, mat(0x333333), 2.25, 0, 0.45);
  box(0.08, 0.34, 0.08, mat(0x333333), 2.95, 0, 0.45);
  const keys = box(0.12, 0.03, 0.06, mat(0xf1c40f, 0.35, 0.6), 2.6, 0.42, 0.55);
  keys.name = 'item-keys';
  // 电视柜与电视
  box(1.7, 0.45, 0.4, mat(0x8a6f52), 1.8, 0, -3.2);
  box(1.4, 0.8, 0.06, mat(0x1a1a1a, 0.3), 1.8, 0.6, -3.35);
  // 落地灯(客厅主照明)
  box(0.06, 1.5, 0.06, mat(0x555555, 0.4), 3.9, 0, 1.2);
  const lampShade = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.3, 20, 1, true), mat(0xf5e6c8, 0.8));
  lampShade.position.set(3.9, 1.6, 1.2);
  group.add(lampShade);

  // ---------- 走廊台阶(卫生间高差, 无扶手) ----------
  box(2.0, 0.15, 0.7, mat(0x8d8d8d), 0.9, 0, -1.75);
  box(2.0, 0.3, 0.7, mat(0x838383), 0.9, 0, -2.45);
  // 警示条
  box(2.0, 0.02, 0.06, mat(0xf1c40f, 0.6), 0.9, 0.16, -1.42);

  // ---------- 卫生间 ----------
  box(2.6, 1.2, 0.1, mat(0xbdc3c7), 2.4, 0, -3.55);    // 半隔墙
  box(0.9, 0.02, 0.6, mat(0x7fb3d5, 0.7), 2.1, 0.01, -2.65); // 门口防滑垫(湿滑点)

  // ---------- 横穿通道的电线(绊倒点) ----------
  const cableCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(1.15, 0.015, -0.9),
    new THREE.Vector3(1.7, 0.02, -0.88),
    new THREE.Vector3(2.25, 0.015, -0.92)
  ]);
  const cable = new THREE.Mesh(
    new THREE.TubeGeometry(cableCurve, 20, 0.018, 8),
    mat(0x1a1a1a, 0.5)
  );
  cable.castShadow = true;
  group.add(cable);
  box(0.16, 0.08, 0.1, mat(0xf8f8f8, 0.4), 2.32, 0, -0.92); // 插线板

  // ---------- 通道杂物(纸箱) ----------
  box(0.5, 0.5, 0.45, mat(0xc19a6b, 1), 2.9, 0, 2.0);
  box(0.4, 0.35, 0.4, mat(0xb3895c, 1), 3.15, 0.5, 1.9);

  // ---------- 厨房(日间动线终点) ----------
  box(1.9, 0.9, 0.6, mat(0xd0c8bb), 4.0, 0, -1.5);
  box(1.9, 0.06, 0.65, mat(0x3b3b3b, 0.4), 4.0, 0.9, -1.5);

  // ---------- 灯光 ----------
  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  const mainLamp = new THREE.PointLight(0xffe0b3, 60, 14, 2);
  mainLamp.position.set(2.0, 2.4, 0.4);
  const bedLamp = new THREE.PointLight(0xffd9a0, 14, 7, 2);
  bedLamp.position.set(-4.0, 1.0, -1.1);
  const corridorLamp = new THREE.PointLight(0xfff2cc, 5, 6, 2);   // 走廊灯: 故意调弱(照明不足)
  corridorLamp.position.set(0.3, 2.0, -1.4);
  const nightLight = new THREE.PointLight(0x86e3ff, 3, 5, 2);     // 起夜地脚灯
  nightLight.position.set(0.85, 0.12, -1.3);
  group.add(ambient, mainLamp, bedLamp, corridorLamp, nightLight);

  return {
    group,
    setNight(on: boolean) {
      const t = on;
      ambient.intensity = t ? 0.12 : 0.55;
      mainLamp.intensity = t ? 4 : 60;
      bedLamp.intensity = t ? 2 : 14;
      corridorLamp.intensity = t ? 1.2 : 5;
      nightLight.intensity = t ? 8 : 3;
    }
  };
}