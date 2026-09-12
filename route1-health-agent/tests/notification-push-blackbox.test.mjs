/**
 * 浏览器黑盒：派发引擎真的调用了 window.Notification。
 *
 * 上一版 smoke 只验证了文案与交互，没有覆盖"系统通知是否真的弹出来"这一环。
 * 这一版用 Playwright grant 通知权限 + addInitScript 替换 window.Notification ，
 * 走真实 UI 路径（老人授权 + 生成邀请码 → 家属绑定）让派发引擎跑起来，
 * 验证 BrowserNotificationChannel.sendBrowserPush 真的构造了 Notification 实例。
 */
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { seedDemoProfile } from './helpers/demo-seed.mjs';
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const PORT = Number(process.env.NOTIF_SMOKE_PORT ?? 4174);

let serverProcess = null;

function log(...args) {
  console.log('[notif-push-smoke]', ...args);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} 退出码 ${code}`))));
    p.on('error', reject);
  });
}

async function ensureBuild() {
  if (!existsSync(DIST) || !existsSync(resolve(DIST, 'index.html'))) {
    log('dist/ 不存在，先 build');
    await run('npm', ['run', 'build']);
  } else {
    log('dist/ 已存在');
  }
}

function startPreview() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const onData = (chunk) => {
      const text = chunk.toString();
      process.stdout.write('[preview] ' + text);
      if (text.includes('Local:') || text.includes('localhost')) resolve();
    };
    serverProcess.stdout.on('data', onData);
    serverProcess.stderr.on('data', onData);
    serverProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) reject(new Error(`vite preview 退出码 ${code}`));
    });
    setTimeout(() => reject(new Error('vite preview 启动超时')), 30000);
  });
}

function stopPreview() {
  if (serverProcess) {
    try {
      serverProcess.kill('SIGTERM');
    } catch {}
    serverProcess = null;
  }
}

async function fetchReady() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) return;
    } catch {}
    await wait(250);
  }
  throw new Error('preview server 未就绪');
}

async function runSmoke() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'zh-CN' });
  // 授权系统通知权限，否则 sendBrowserPush 会返回 unavailable 而不是真的弹。
  await context.grantPermissions(['notifications'], { origin: `http://localhost:${PORT}` });

  const page = await context.newPage();
  seedDemoProfile(page);
  page.on('console', (msg) => {
    if (msg.type() === 'error') log('console.error:', msg.text());
  });
  page.on('pageerror', (err) => log('pageerror:', err.message));

  const SPY_KEY = '__ankang_notif_spy_calls_v1';
  // 清理上一轮可能残留的派发台账与 spy 记录，避免影响 dedup 断言。
  const cleanupPage = await context.newPage();
  await cleanupPage.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await cleanupPage.evaluate(
    ([spyKey, dispatchKey]) => {
      try {
        localStorage.removeItem(spyKey);
        localStorage.removeItem(dispatchKey);
      } catch {}
    },
    [SPY_KEY, 'ankang-route1-dispatch-records-v1'],
  );
  await cleanupPage.close();

  // 在 app 加载之前，用 addInitScript 替换 window.Notification 为可记录的 spy。
  // calls 数组持久化到 localStorage，确保 page.reload() 后记录不丢——这正是断点 1
  // 跨刷新去重要验证的核心：刷新前派发的通知数应该等于刷新后看到的总数。
  await page.addInitScript((key) => {
    let stored;
    try {
      stored = JSON.parse(localStorage.getItem(key) || '[]');
    } catch {
      stored = [];
    }
    const calls = Array.isArray(stored) ? stored : [];
    const OriginalNotification = window.Notification;
    function SpyNotification(title, options) {
      calls.push({ title, body: options?.body, tag: options?.tag, at: Date.now() });
      try {
        localStorage.setItem(key, JSON.stringify(calls));
      } catch {}
      try {
        if (OriginalNotification && typeof OriginalNotification === 'function') {
          return new OriginalNotification(title, options);
        }
      } catch {}
      return { title, body: options?.body, close() {}, addEventListener() {} };
    }
    SpyNotification.permission = 'granted';
    SpyNotification.requestPermission = async () => 'granted';
    SpyNotification.getCalls = () => calls;
    SpyNotification.resetCalls = () => {
      calls.length = 0;
      try {
        localStorage.removeItem(key);
      } catch {}
    };
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      writable: true,
      value: SpyNotification,
    });
  }, SPY_KEY);

  const results = [];
  function check(name, ok, detail = '') {
    results.push({ name, ok, detail });
    log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  }

  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});

    // 1. 进入老人端
    const elderBtn = page.getByRole('button', { name: /我是老人/ }).first();
    await elderBtn.click({ timeout: 3000 });
    await wait(800);

    // 2. 同意家属共享
    const grantBtn = page.getByRole('button', { name: /同意以后需要时告诉家属/ }).first();
    const grantVisible = await grantBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (!grantVisible) {
      check('老人端出现"同意共享"按钮', false);
      throw new Error('未找到同意共享按钮，可能已经被默认同意');
    }
    await grantBtn.click();
    await wait(800);
    check('老人端同意家属共享', true);

    // 3. 生成邀请码
    const inviteBtn = page.getByRole('button', { name: /生成家属邀请码/ }).first();
    const inviteVisible = await inviteBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (!inviteVisible) throw new Error('未找到生成邀请码按钮');
    await inviteBtn.click();
    await wait(600);
    // 邀请码是 AN-YYYY-NNNN 格式
    const inviteCode = await page.evaluate(() => {
      const match = document.body.innerText.match(/AN-\d{4}-[A-Z2-9]{10}/);
      return match ? match[0] : null;
    });
    check('老人端生成邀请码', !!inviteCode, inviteCode || '未找到');
    if (!inviteCode) throw new Error('邀请码未生成');

    // 4. 切到家属端
    const switchBtn = page.locator('text=切换身份').first();
    await switchBtn.click({ force: true });
    await wait(600);
    const familyBtn = page.getByRole('button', { name: /我是家属/ }).first();
    await familyBtn.click({ timeout: 3000 });
    await wait(800);

    // 5. 输入邀请码并绑定
    const inviteInput = page.locator('input[placeholder*="AN-"]').first();
    await inviteInput.fill(inviteCode);
    const bindBtn = page.getByRole('button', { name: /^绑定$/ }).first();
    await bindBtn.click();
    await wait(1200);

    // 6. 验证派发引擎调到了 Notification（demo 数据里有 shareable 的 fall/bpHigh 等 urgent finding）
    const calls = await page.evaluate(() => window.Notification.getCalls());
    check('派发引擎真弹了系统通知', calls.length >= 1, `calls=${calls.length}`);
    if (calls.length >= 1) {
      const first = calls[0];
      check(
        '系统通知带 findingId 标签（用于系统去重）',
        typeof first.tag === 'string' && first.tag.startsWith('family-'),
        `tag=${first.tag}`,
      );
      check('系统通知带正文', !!first.body, `body="${first.body}"`);
    }

    // 7. 验证跨刷新 dedup：刷新后同一条 finding 不再重弹
    const callsBefore = calls.length;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await wait(1500);
    const callsAfter = await page.evaluate(() => window.Notification.getCalls());
    check(
      '刷新后系统通知没有重复弹',
      callsAfter.length === callsBefore,
      `before=${callsBefore}, after=${callsAfter.length}`,
    );
  } catch (err) {
    log('错误:', err instanceof Error ? err.message : String(err));
    check('完成所有断言', false, err instanceof Error ? err.message : String(err));
  } finally {
    await page.screenshot({ path: resolve(ROOT, 'tests', 'notif-push-smoke.png'), fullPage: true }).catch(() => {});
    await context.close();
    await browser.close();
  }

  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  log(`总计: ${passed}/${total} 通过`);
  if (passed < total) {
    // 强制退出前先收掉 preview 子进程，否则 runSmoke 里的 exit 会跳过 main 的 finally。
    stopPreview();
    process.exit(1);
  }
  // CI 的公共信令可达时，PeerJS 的 WebSocket 会一直挂着事件循环——断言跑完也必须强制退出。
  stopPreview();
  process.exit(0);
}

async function main() {
  await ensureBuild();
  try {
    await startPreview();
    await fetchReady();
    log(`preview 服务已就绪 (http://localhost:${PORT})`);
    await runSmoke();
  } finally {
    stopPreview();
    await wait(200);
  }
}

main().catch((err) => {
  console.error('[notif-push-smoke] 错误:', err);
  process.exit(1);
});
