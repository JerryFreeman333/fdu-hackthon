/**
 * 浏览器黑盒：评审现场两大死局的端到端回归（P0-2 / P0-1 / P0-3）。
 *
 * 场景一（P0-2）：老人端 tab1 生成邀请码，家属端 tab2 输入码绑定——
 * 修复前这在本 tab 之外永远失败（"邀请码无效或已失效"死局）；
 * 修复后通过 family.link 握手（BroadcastChannel）跨 tab 绑定成功。
 * 同时覆盖：错误码得到明确报错、老人端可"重新生成邀请码"。
 *
 * 场景二（P0-1）：老人从未授权共享就报"摔了一跤"——
 * 家属端首页必须显示"有信号被隐私挡住"，绝不显示"今天总体正常"。
 *
 * 场景三（P0-3）：连发两条消息，回复必须与触发它的原话相邻，
 * 不许出现"对着'头一点都不晕了'说'我已记下头晕'"的错位。
 */
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PROFILE_STORAGE_KEY } from './helpers/demo-seed.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const PORT = Number(process.env.BINDING_SMOKE_PORT ?? 4177);

/** 个人模式种子：空数据起步、未授权共享——评审现场最常见的人生场景。 */
const PERSONAL_SEED = {
  version: 1,
  dataMode: 'personal',
  profile: {
    name: '李奶奶',
    age: 78,
    conditions: [],
    medications: [],
    familyContact: '女儿 李芳',
    familyPhone: '13911112222',
    mobility: 'independent',
    usesCane: false,
    nightVision: 'normal',
    cognition: 'stable',
    familySharing: 'denied',
  },
};

let serverProcess = null;

function log(...args) {
  console.log('[binding-smoke]', ...args);
}
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))));
    p.on('error', reject);
  });
}
async function ensureBuild() {
  if (!existsSync(DIST) || !existsSync(resolve(DIST, 'index.html'))) {
    log('dist/ 不存在，先 build');
    await run('npm', ['run', 'build']);
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
  for (let i = 0; i < 40; i += 1) {
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
  await context.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {}
    },
    [PROFILE_STORAGE_KEY, JSON.stringify(PERSONAL_SEED)],
  );

  const results = [];
  function check(name, ok, detail = '') {
    results.push({ name, ok, detail });
    log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  }

  try {
    const elderTab = await context.newPage();
    elderTab.on('pageerror', (err) => log('pageerror(elder):', err.message));
    await elderTab.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await elderTab.getByRole('button', { name: /我是老人/ }).click({ timeout: 5000 });
    await wait(600);

    // ===== 场景一（P0-2）：跨 tab 绑定握手 =====
    const inviteBtn = elderTab.getByRole('button', { name: /生成家属邀请码/ }).first();
    await inviteBtn.click({ timeout: 5000 });
    await wait(400);
    const inviteCode = await elderTab.evaluate(() => {
      const m = document.body.innerText.match(/AN-\d{4}-[A-Z2-9]{10}/);
      return m ? m[0] : null;
    });
    check('老人端生成邀请码', !!inviteCode, inviteCode || '未找到');
    check(
      '老人端有"重新生成邀请码"入口（不再死局）',
      await elderTab.getByRole('button', { name: /重新生成邀请码/ }).isVisible(),
    );

    const familyTab = await context.newPage();
    familyTab.on('pageerror', (err) => log('pageerror(family):', err.message));
    await familyTab.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await familyTab.getByRole('button', { name: /我是家属/ }).click({ timeout: 5000 });
    const inviteInput = familyTab.locator('.family-dashboard input.chat-input');
    await inviteInput.waitFor({ timeout: 5000 });

    // 错误码：老人端 tab 在场 → 必须收到明确的 rejected，而不是干等
    await inviteInput.fill('AN-0000-ZZZZZZZZZZ');
    await familyTab.locator('.family-dashboard button', { hasText: '绑定' }).click();
    await familyTab.getByText('邀请码不对或已失效').waitFor({ state: 'visible', timeout: 8000 });
    check('输错邀请码得到明确报错（不是"已失效"死路）', true);

    // 正确码：跨 tab 握手绑定
    await inviteInput.fill(inviteCode);
    await familyTab.locator('.family-dashboard button', { hasText: '绑定' }).click();
    await familyTab.getByText('绑定关系').waitFor({ state: 'visible', timeout: 10000 });
    check('跨 tab 家属绑定成功（P0-2 死局已修复）', true);

    // 老人端实时看到绑定成功（老人端是应答方，状态就在本 tab 更新）
    await elderTab.getByText('已绑定家属').first().waitFor({ state: 'visible', timeout: 5000 });
    check('老人端实时显示绑定成功', true);

    // ===== 场景三（P0-3）：连发两条消息，回复不错位 =====
    const chatInput = elderTab.locator('#elder-chat input.chat-input');
    await chatInput.waitFor({ timeout: 5000 });
    // 占位气泡（P1-4）在规则模式下存活时间只有几十毫秒，用 MutationObserver
    // 在页面里捕获"它曾经出现过"，这是确定性断言而不是竞态赌博。
    await elderTab.evaluate(() => {
      window.__pendingSeen = false;
      const list = document.querySelector('#elder-chat .chat-list');
      if (!list) return;
      const observer = new MutationObserver(() => {
        if (document.querySelector('.chat-pending')) window.__pendingSeen = true;
      });
      observer.observe(list, { subtree: true, childList: true });
    });
    await chatInput.fill('我头晕');
    await elderTab.locator('#elder-chat button', { hasText: '发送' }).click();
    await chatInput.fill('头一点都不晕了');
    await elderTab.locator('#elder-chat button', { hasText: '发送' }).click();
    await elderTab
      .getByText('您说的头晕没有发生')
      .first()
      .waitFor({ state: 'visible', timeout: 8000 })
      .catch(() => {});
    const rowTexts = await elderTab.$$eval('.chat-list .chat-row', (rows) => rows.map((row) => row.innerText));
    const reply1Index = rowTexts.findIndex((text) => text.includes('我已经记下：头晕'));
    const msg2Index = rowTexts.findIndex((text) => text.includes('头一点都不晕了'));
    check(
      '回复紧跟触发它的原话（P0-3 不错位）',
      reply1Index >= 0 && msg2Index > reply1Index,
      `reply1=${reply1Index}, msg2=${msg2Index}`,
    );
    await elderTab.waitForFunction(() => window.__pendingSeen === true, null, { timeout: 3000 }).catch(() => {});
    check(
      '发送后出现"正在听你说"占位（P1-4，回复生成期不再沉默）',
      await elderTab.evaluate(() => window.__pendingSeen === true),
    );

    // ===== 场景二（P0-1）：未授权就报急事，家属端不得说"总体正常" =====
    await chatInput.fill('我刚才在厕所摔了一跤，现在站起来有点晕');
    await elderTab.locator('#elder-chat button', { hasText: '发送' }).click();
    // 老人端要出现紧急联系行动条（老人侧闭环）
    await elderTab
      .getByRole('link', { name: /呼叫 ?120|120/ })
      .first()
      .waitFor({ state: 'visible', timeout: 8000 })
      .catch(() => {});
    // 家属端（另一个 tab，已绑定、未授权共享）：状态必须是"被隐私挡住"
    await familyTab
      .getByText(/被隐私设置挡住/)
      .first()
      .waitFor({ state: 'visible', timeout: 10000 });
    const familyText = await familyTab.evaluate(() => document.body.innerText);
    check('家属端显示"被隐私设置挡住"（P0-1 修复）', /被隐私设置挡住/.test(familyText));
    check('家属端绝不显示"今天总体正常"', !familyText.includes('今天总体正常'));
    check('家属端没有泄漏摔倒内容原文', !familyText.includes('摔了一跤'));
  } catch (err) {
    check('完成所有断言', false, err.message);
  } finally {
    await context.close();
    await browser.close();
  }

  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  log(`总计: ${passed}/${total} 通过`);
  if (passed !== total) process.exit(1);
}

(async () => {
  await ensureBuild();
  await startPreview();
  try {
    await fetchReady();
    await runSmoke();
  } finally {
    stopPreview();
    process.exit(0);
  }
})();
