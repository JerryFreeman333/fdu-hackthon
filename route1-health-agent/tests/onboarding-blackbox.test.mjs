/**
 * 评审 P0-4/P1-2 回归（浏览器黑盒）：首启二选一、建档、编辑档案、清空数据。
 * 锁定：新用户不再被默认塞进"王秀兰奶奶"的身份；personal 模式从空白开始。
 */
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PORT = Number(process.env.ONBOARDING_PORT ?? 4178);
const BASE = `http://localhost:${PORT}`;

let serverProcess = null;
const results = [];

function log(...args) {
  console.log('[onboarding-blackbox]', ...args);
}

function check(name, ok, detail = '') {
  results.push({ name, ok });
  log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

function run(cmd, args, envExtra = {}) {
  return new Promise((resolvePromise, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...envExtra } });
    p.on('exit', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`${cmd} ${args.join(' ')} 退出码 ${code}`)),
    );
    p.on('error', reject);
  });
}

function startPreview() {
  return new Promise((resolvePromise, reject) => {
    serverProcess = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const onData = (chunk) => {
      const text = chunk.toString();
      if (text.includes('Local:') || text.includes('localhost')) resolvePromise();
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
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return;
    } catch {}
    await wait(250);
  }
  throw new Error('preview server 未就绪');
}

async function runOnboardingSuite() {
  const browser = await chromium.launch({ headless: true });

  // ===== 场景 A：全新用户 → 首启二选一 → 建档 =====
  {
    const context = await browser.newContext({ locale: 'zh-CN' });
    const page = await context.newPage();
    page.on('pageerror', (err) => log('pageerror:', err.message));
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

    await page.getByText('先选一下怎么开始').waitFor({ state: 'visible', timeout: 10000 });
    check('全新用户首先看到首启选择，而不是写死的演示档案', true);

    await page.getByRole('button', { name: /这是我自己用/ }).click();
    await page.getByText('先认识一下您').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('#profile-name').fill('李奶奶');
    await page.locator('#profile-med').fill('降压药 每日一次');
    await page.getByRole('button', { name: '添加' }).click();
    await page.locator('#profile-family-phone').fill('13911112222');
    await page.getByRole('button', { name: '好了，开始使用' }).click();
    await page.getByRole('button', { name: /我是老人/ }).click();
    await page.locator('.persona-name').waitFor({ state: 'visible', timeout: 5000 });
    const headerName = await page.locator('.persona-name').textContent();
    check('建档后老人端显示用户自己的称呼', headerName?.includes('李奶奶') === true, headerName ?? '');

    const demoSeedText = await page.getByText('今天很累，什么都不想干').count();
    check('personal 模式从空白开始，没有合成聊天种子', demoSeedText === 0);
    // P2 信息架构收敛后，"数据从哪儿来"收进可展开区块：展开后再断言 personal 模式文案
    await page.locator('details.advanced-details summary', { hasText: '数据从哪儿来' }).click();
    await page.getByText('当前版本未接入真实硬件').waitFor({ state: 'visible', timeout: 5000 });
    check('personal 模式的设备说明不再声称"模拟设备数据"', true);

    // 刷新后档案仍在，不回首启（角色选择是会话状态，需重选一次角色）。
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /我是老人/ }).click();
    await page.locator('.persona-name').waitFor({ state: 'visible', timeout: 5000 });
    check(
      '刷新后档案仍在（不回首启）',
      (await page.locator('.persona-name').textContent())?.includes('李奶奶') === true,
    );

    // 编辑档案：打开"查看我的状态" → 编辑 → 改称呼 → 保存
    await page.getByText('查看我的状态（可选）').click();
    await page.getByRole('button', { name: '编辑我的档案' }).waitFor({ state: 'visible', timeout: 10000 });
    await page.getByRole('button', { name: '编辑我的档案' }).click();
    await page.locator('#profile-name').fill('赵奶奶');
    await page.getByRole('button', { name: '保存档案' }).click();
    await page.locator('.persona-name').waitFor({ state: 'visible', timeout: 5000 });
    check('编辑档案立即生效到界面上', (await page.locator('.persona-name').textContent())?.includes('赵奶奶') === true);
    await context.close();
  }

  // ===== 场景 B：全新用户 → 体验演示档案 =====
  {
    const context = await browser.newContext({ locale: 'zh-CN' });
    const page = await context.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /体验演示档案/ }).click();
    await page.getByRole('button', { name: /我是老人/ }).click();
    await page.locator('.persona-name').waitFor({ state: 'visible', timeout: 5000 });
    const headerName = await page.locator('.persona-name').textContent();
    check('选择演示档案 → 进入王秀兰奶奶的完整演示', headerName?.includes('王秀兰奶奶') === true, headerName ?? '');
    await context.close();
  }

  // ===== 场景 C：清空数据 → 回到首启选择 =====
  {
    const context = await browser.newContext({ locale: 'zh-CN' });
    const page = await context.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /体验演示档案/ }).click();
    await page.getByRole('button', { name: /我是老人/ }).click();
    await page.locator('.persona-name').waitFor({ state: 'visible', timeout: 5000 });
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByText('查看我的状态（可选）').click();
    await page.getByRole('button', { name: '清空本机全部数据' }).click();
    await page.getByText('先选一下怎么开始').waitFor({ state: 'visible', timeout: 10000 });
    check('清空本机数据后回到首启选择（删档重来）', true);
    await context.close();
  }

  await browser.close();
}

async function main() {
  // 测试构建必须剥离理解层 LLM 配置，避免任何聊天路径真的调用外部模型。
  const stripLlmEnv = { VITE_UNDERSTANDING_LLM_API_KEY: '', VITE_UNDERSTANDING_LLM_BASE_URL: '' };
  await run('npm', ['run', 'build'], stripLlmEnv);
  await startPreview();
  try {
    await fetchReady();
    await runOnboardingSuite();
  } finally {
    stopPreview();
  }
  const failed = results.filter((item) => !item.ok).length;
  log(failed === 0 ? '全部通过' : `${failed} 项失败`);
  // CI 的公共信令可达时，PeerJS 的 WebSocket 会一直挂着事件循环——断言跑完也必须强制退出。
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  stopPreview();
  process.exit(1);
});
