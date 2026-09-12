/**
 * 评审 P0-1 回归（浏览器黑盒）：老人端一键呼救。
 * 现场时序：老人发"胸口疼得厉害，喘不上气"，回复说"应立即寻求急救"，
 * 但同一个界面没有任何可按的电话按钮。本用例锁定：
 * 1. 老人端常驻 SOS 卡，120 / 家属 tel: 链接直接可见；
 * 2. 胸痛回复气泡下方出现紧急联系行动条。
 * 用 preview + 构建产物运行；构建时剥离理解层 LLM 配置，避免聊天用例真的调用外部模型。
 */
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { seedDemoProfile } from './helpers/demo-seed.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PORT = Number(process.env.ELDER_SOS_PORT ?? 4177);
const BASE = `http://localhost:${PORT}`;

let serverProcess = null;
const results = [];

function log(...args) {
  console.log('[elder-sos-blackbox]', ...args);
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

async function runSosSuite() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'zh-CN' });
  const page = await context.newPage();
  seedDemoProfile(page);
  page.on('pageerror', (err) => log('pageerror:', err.message));

  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

    // Case 1：老人端常驻 SOS 卡。
    await page.getByRole('button', { name: /我是老人/ }).click();
    const tel120 = page.locator('.sos-card a[href="tel:120"]');
    await tel120.waitFor({ state: 'visible', timeout: 10000 });
    check('老人端常驻 SOS：呼叫 120 可直接按', true);
    const familyTel = page.locator('.sos-card a[href="tel:13800006677"]');
    check('SOS 卡展示家属电话（演示档案 138****6677）', (await familyTel.count()) === 1);

    // Case 2：胸痛消息的回复下方出现紧急联系行动条。
    const input = page.locator('#elder-chat input.chat-input');
    await input.fill('胸口疼得厉害，喘不上气');
    await page.locator('#elder-chat button.btn-primary', { hasText: '发送' }).click();
    await page.getByText('应立即寻求急救', { exact: false }).first().waitFor({ state: 'visible', timeout: 20000 });
    const barLinks = page.locator('.chat-bubble .safety-actions a[href^="tel:"]');
    const linkCount = await barLinks.count();
    check('胸痛回复气泡下出现紧急联系行动条（tel: 链接 ≥ 2）', linkCount >= 2, `实际 ${linkCount} 个`);
    const chatTel120 = page.locator('.chat-bubble .safety-actions a[href="tel:120"]');
    check('行动条内可直接呼叫 120', (await chatTel120.count()) === 1);
  } finally {
    await browser.close();
  }
}

async function main() {
  // 测试构建必须剥离理解层 LLM 配置：process env 优先于 .env，置空即回落纯规则模式。
  const stripLlmEnv = { VITE_UNDERSTANDING_LLM_API_KEY: '', VITE_UNDERSTANDING_LLM_BASE_URL: '' };
  await run('npm', ['run', 'build'], stripLlmEnv);
  await startPreview();
  try {
    await fetchReady();
    await runSosSuite();
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
