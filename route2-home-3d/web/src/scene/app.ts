import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SceneMode } from '../types';

/**
 * 场景管理器: 统一「合成演示」与「真实高斯模型」两种模式的
 * 渲染循环 / 相机控制 / 拾取 / 飞行 / 日夜切换。
 */
export class SceneManager {
  mode: SceneMode;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls!: OrbitControls;
  private renderer: THREE.WebGLRenderer | null = null;
  private gsViewer: any = null;
  private clock = new THREE.Clock();
  private frameCallbacks: Array<(dt: number, elapsed: number) => void> = [];
  private night = false;
  private demoSetNight: ((on: boolean) => void) | null = null;
  private fly: {
    t: number; duration: number;
    fromPos: THREE.Vector3; toPos: THREE.Vector3;
    fromTarget: THREE.Vector3; toTarget: THREE.Vector3;
  } | null = null;

  constructor(mode: SceneMode) {
    this.mode = mode;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.05, 300);
  }

  /** demo 模式: 自建 renderer + 控制器 */
  initDemo(demoSetNight: (on: boolean) => void) {
    this.demoSetNight = demoSetNight;
    this.scene.background = new THREE.Color(0x101418);
    this.scene.fog = new THREE.Fog(0x101418, 14, 34);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('app')!.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 0.8;
    this.controls.maxDistance = 26;

    this.camera.position.set(5.2, 4.6, 7.2);
    this.controls.target.set(-0.5, 0.4, 0);
    this.loop();
  }

  /** real 模式: GaussianSplats3D 接管渲染循环 */
  async initReal(modelUrl: string, onProgress?: (p: number) => void) {
    const GS = await import('@mkkellogg/gaussian-splats-3d');
    this.gsViewer = new GS.Viewer({
      threeScene: this.scene,
      gpuAccelerated: true,
      dynamicScene: true,
      sharedMemoryForWorkers: false
    });
    await this.gsViewer.addSplatScene(modelUrl, {
      splatScale: 1.0,
      dynamicScene: true,
      sceneRevealMode: GS.SceneRevealMode.Instant,
      showLoadingUI: true,
      onProgress
    });
    this.controls = this.gsViewer.orbitControls;
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.55;
    this.camera.position.set(4, 4, 6);
    this.controls.target.set(0, 0.5, 0);
    this.gsViewer.start();
    this.gsViewer.registerBeforeRenderCallback(() => this.tick(this.clock.getDelta()));
  }

  onUpdate(cb: (dt: number, elapsed: number) => void) {
    this.frameCallbacks.push(cb);
  }

  private loop = () => {
    requestAnimationFrame(this.loop);
    const dt = this.clock.getDelta();
    this.tick(dt);
    if (this.renderer) this.renderer.render(this.scene, this.camera);
    this.controls.update();
  };

  private tick(dt: number) {
    if (this.fly) {
      this.fly.t = Math.min(1, this.fly.t + dt / this.fly.duration);
      const e = this.fly.t < 0.5
        ? 4 * this.fly.t ** 3
        : 1 - (-2 * this.fly.t + 2) ** 3 / 2;
      this.camera.position.lerpVectors(this.fly.fromPos, this.fly.toPos, e);
      this.controls.target.lerpVectors(this.fly.fromTarget, this.fly.toTarget, e);
      if (this.fly.t >= 1) this.fly = null;
    }
    const elapsed = this.clock.elapsedTime;
    for (const cb of this.frameCallbacks) cb(dt, elapsed);
  }

  /** 相机平滑飞向某点并注视目标 */
  flyTo(pos: THREE.Vector3, lookAt: THREE.Vector3, duration = 1.4) {
    this.fly = {
      t: 0, duration,
      fromPos: this.camera.position.clone(),
      toPos: pos.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: lookAt.clone()
    };
  }

  /** 屏幕坐标拾取(用于点击 3D 标记) */
  pick(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Intersection[] {
    const el = this.renderer?.domElement ?? this.gsViewer?.renderer?.domElement;
    if (!el) return [];
    const rect = el.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray.intersectObjects(objects, false);
  }

  /** 日夜切换: demo 调灯光, real 模式用 CSS 滤镜模拟夜景 */
  setNight(on: boolean) {
    this.night = on;
    this.demoSetNight?.(on);
    document.body.classList.toggle('night', on && this.mode === 'real');
  }

  isNight() { return this.night; }
}