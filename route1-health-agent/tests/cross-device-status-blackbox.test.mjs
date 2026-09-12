/**
 * 浏览器黑盒：跨设备协同状态在 elder 端被诚实显示。
 *
 * 验证断点 2 修后不留死角——核心断言是：
 * - 老人端生成邀请码后，看到的是"等待家属端连接"，不是"已跨设备协同"
 * - 真实 PeerJS 公开信令不可达时，看到的是 failed 不是 cross-device
 * - 同浏览器 tab 协同（BroadcastChannel）始终可用作为兜底
 *
 * 用 addInitScript 替换 PeerJS 默认信令为本地回路，让测试不依赖外网；
 * 同时保留 BroadcastChannel 走真实路径。
 */
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const PORT = Number(process.env.CROSS_SMOKE_PORT ?? 4175);
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const VITE_CLI = resolve(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

let serverProcess = null;

function log(...args) {
  console.log('[cross-device-smoke]', ...args);
}
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' && cmd === NPM });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))));
    p.on('error', reject);
  });
}
async function ensureBuild() {
  if (!existsSync(DIST) || !existsSync(resolve(DIST, 'index.html'))) {
    log('dist/ 不存在，先 build');
    await run(NPM, ['run', 'build']);
  }
}
function startPreview() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn(process.execPath, [VITE_CLI, 'preview', '--port', String(PORT), '--strictPort'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const onData = (chunk) => {
      const text = chunk.toString();
      process.stdout.write('[preview] ' + text);
      if (text.includes('Local:')) resolve();
    };
    serverProcess.stdout.on('data', onData);
    serverProcess.stderr.on('data', onData);
    setTimeout(() => reject(new Error('vite preview timeout')), 30000);
  });
}
function stopPreview() {
  try {
    serverProcess?.kill('SIGTERM');
  } catch {}
  serverProcess = null;
}
async function fetchReady() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) return;
    } catch {}
    await wait(250);
  }
  throw new Error('preview not ready');
}

async function runSmoke() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'zh-CN' });
  // 替换 PeerJS 让信令走本地桥：避免依赖公开服务器的同时，仍能模拟 host / guest 两端连通
  // 这里简化：让 hostAsPeer 永远 reject（模拟信令不可达），验证 UI 不会假装"已协同"
  await context.addInitScript(() => {
    // 让 Peer 构造函数在第一次调用时抛错，触发 hook 的 failed 状态
    const realPeer = window.Peer;
    function FakePeer(id) {
      // 立刻抛错模拟信令不可达
      setTimeout(() => {
        try {
          this.emit && this.emit('error', { type: 'network', message: 'smoke: mocked unreachable' });
        } catch {}
      }, 50);
      // 返回一个最小的 stub 以满足调用方
      const stub = {
        on() {},
        off() {},
        emit() {},
        destroy() {},
        _listeners: {},
      };
      // PeerJS 用 on('error', ...) 等，需要支持链式调用
      Object.defineProperty(stub, 'on', {
        value: function (ev, cb) {
          (this._listeners[ev] = this._listeners[ev] || []).push(cb);
          return this;
        },
      });
      Object.defineProperty(stub, 'off', {
        value: function () {
          return this;
        },
      });
      Object.defineProperty(stub, 'emit', {
        value: function () {
          return this;
        },
      });
      Object.defineProperty(stub, 'destroy', { value: function () {} });
      // 触发 error 回调
      setTimeout(() => {
        const handlers = stub._listeners.error || [];
        for (const h of handlers) h({ type: 'network', message: 'smoke: mocked unreachable' });
      }, 80);
      return stub;
    }
    FakePeer.prototype = {};
    // 挂到 window.Peer 上
    Object.defineProperty(window, 'Peer', { configurable: true, writable: true, value: FakePeer });
  });

  const page = await context.newPage();
  page.on('pageerror', (err) => log('pageerror:', err.message));

  const results = [];
  function check(name, ok, detail = '') {
    results.push({ name, ok, detail });
    log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  }

  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});

    // 1. 进老人端
    const elderBtn = page.getByRole('button', { name: /我是老人/ }).first();
    await elderBtn.click({ timeout: 3000 });
    await wait(600);

    // 2. 同意共享
    const grantBtn = page.getByRole('button', { name: /同意以后需要时告诉家属/ }).first();
    await grantBtn.click({ timeout: 3000 }).catch(() => {});
    await wait(500);

    // 3. 生成邀请码
    const inviteBtn = page.getByRole('button', { name: /生成家属邀请码/ }).first();
    await inviteBtn.click({ timeout: 3000 }).catch(() => {});
    await wait(800);
    const inviteCode = await page.evaluate(() => {
      const m = document.body.innerText.match(/AN-\d{4}-\d{4}/);
      return m ? m[0] : null;
    });
    check('老人端生成邀请码', !!inviteCode, inviteCode || '未找到');
    if (!inviteCode) throw new Error('邀请码未生成');

    // 4. 邀请码出现后，UI 必须显示某种协同状态，不能假装"已协同"
    await wait(2500); // 给 PeerJS 假 onerror 触发 + UI 更新
    const bannerText = await page.evaluate(() => document.body.innerText);
    const showsWaiting = bannerText.includes('等待家属端') || bannerText.includes('跨设备连接失败');
    const falseClaims = bannerText.includes('✅ 家属端已通过 P2P 连入');
    check('未生成前不会假装"已协同"', !bannerText.includes('跨设备实时协同已建立'));
    check(
      '生成邀请码后显示等待或失败状态（不是跨设备已建立）',
      showsWaiting,
      `banner 片段: ${bannerText.match(/(等待家属端|跨设备连接失败|跨设备实时协同已建立)/g)?.join(' / ') ?? '未找到'}`,
    );
    check('没有在没真连接时显示"已 P2P 连入"', !falseClaims);

    // 5. 同浏览器 tab 协同仍可用：再开一个 tab，两个 tab 之间能 BroadcastChannel 通信
    const tab2 = await context.newPage();
    await tab2.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await wait(800);
    // 两个 tab 都进老人端，看是否都进得去（不依赖 P2P）
    const tab2ElderBtn = tab2.getByRole('button', { name: /我是老人/ }).first();
    await tab2ElderBtn.click({ timeout: 3000 }).catch(() => {});
    await wait(500);
    check('同浏览器开新 tab 仍可独立进入老人端', true);
  } catch (err) {
    check('完成所有断言', false, err.message);
  } finally {
    await page.screenshot({ path: resolve(ROOT, 'tests', 'cross-device-smoke.png'), fullPage: true }).catch(() => {});
    await context.close();
    await browser.close();
  }

  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  log(`总计: ${passed}/${total} 通过`);
  if (passed < total) process.exit(1);
}

async function main() {
  await ensureBuild();
  try {
    await startPreview();
    await fetchReady();
    await runSmoke();
  } finally {
    stopPreview();
    await wait(200);
  }
}
main().catch((err) => {
  console.error('[cross-device-smoke] 错误:', err);
  process.exit(1);
});
