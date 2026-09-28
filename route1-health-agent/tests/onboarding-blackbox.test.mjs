/**
 * 评审 P0-4/P1-2 回归（浏览器黑盒）：首启二选一、建档、编辑档案、清空数据。
 * 锁定：新用户不再被默认塞进"王秀兰奶奶"的身份；personal 模式从空白开始。
 */
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { startPreview as startPreviewShared } from './helpers/preview-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PORT = Number(process.env.ONBOARDING_PORT ?? 4178);
const BASE = `http://localhost:${PORT}`;
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

let previewHandle = null;
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
    const p = spawn(cmd, args, {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...envExtra },
      shell: process.platform === 'win32' && cmd === NPM,
    });
    p.on('exit', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`${cmd} ${args.join(' ')} 退出码 ${code}`)),
    );
    p.on('error', reject);
  });
}

async function startPreview() {
  previewHandle = await startPreviewShared({ port: PORT, prefix: '[preview]' });
}

function stopPreview() {
  previewHandle?.stop();
  previewHandle = null;
}

async function runOnboardingSuite() {
  const browser = await chromium.launch({ headless: true });

  // ===== 场景 A：全新用户 → 首启二选一 → 建档 =====
  {
    const context = await browser.newContext({ locale: 'zh-CN' });
    const page = await context.newPage();
    page.on('pageerror', (err) => log('pageerror:', err.message));
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

    await page.getByText('先告诉我们你的身份').waitFor({ state: 'visible', timeout: 10000 });
    check('全新用户首先看到首启选择，而不是写死的演示档案', true);

    await page.getByRole('button', { name: /老人端/ }).click();
    await page.getByRole('button', { name: /创建真实档案/ }).click();
    // 重构后新增"账号与授权"中间步：微信登录不可用时先建本机档案
    await page.getByRole('button', { name: /暂不登录，先创建本机档案/ }).click();
    await page.getByText('先认识一下您').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('#profile-name').fill('李奶奶');
    await page.locator('#profile-med').fill('降压药 每日一次');
    await page.getByRole('button', { name: '添加' }).click();
    await page.locator('#profile-family-phone').fill('13911112222');
    await page.getByRole('button', { name: '好了，开始使用' }).click();
    await page.locator('.elder-welcome h1').waitFor({ state: 'visible', timeout: 5000 });
    const headerName = await page.locator('.elder-welcome h1').textContent();
    check('建档后老人端显示用户自己的称呼', headerName?.includes('李奶奶') === true, headerName ?? '');

    const demoSeedText = await page.getByText('今天很累，什么都不想干').count();
    check('personal 模式从空白开始，没有合成聊天种子', demoSeedText === 0);
    await page.getByRole('button', { name: '我的' }).last().click();
    await page.getByText('自用模式，不注入演示数据').waitFor({ state: 'visible', timeout: 5000 });
    check('personal 模式明确不注入演示数据', true);

    // 刷新后档案与用户明确选择的角色都仍在，不重复询问。
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.elder-welcome h1').waitFor({ state: 'visible', timeout: 5000 });
    check(
      '刷新后档案仍在（不回首启）',
      (await page.locator('.elder-welcome h1').textContent())?.includes('李奶奶') === true,
    );

    // 编辑档案：我的 → 个人资料 → 改称呼 → 保存
    await page.getByRole('button', { name: '我的' }).last().click();
    await page.locator('.settings-list button', { hasText: '个人资料' }).click();
    await page.locator('#profile-name').fill('赵奶奶');
    await page.getByRole('button', { name: '保存档案' }).click();
    check('编辑档案立即生效到界面上', (await page.locator('body').innerText()).includes('赵奶奶'));
    await context.close();
  }

  // ===== 场景 B：全新用户 → 体验演示档案 =====
  {
    const context = await browser.newContext({ locale: 'zh-CN' });
    const page = await context.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /老人端/ }).click();
    await page.getByRole('button', { name: /体验王秀兰演示档案/ }).click();
    await page.locator('.elder-welcome h1').waitFor({ state: 'visible', timeout: 5000 });
    const headerName = await page.locator('.elder-welcome h1').textContent();
    check('选择演示档案 → 进入王秀兰奶奶的完整演示', headerName?.includes('王秀兰奶奶') === true, headerName ?? '');
    await context.close();
  }

  // ===== 场景 C：清空数据 → 回到首启选择 =====
  {
    const context = await browser.newContext({ locale: 'zh-CN' });
    const page = await context.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /老人端/ }).click();
    await page.getByRole('button', { name: /体验王秀兰演示档案/ }).click();
    await page.locator('.elder-welcome h1').waitFor({ state: 'visible', timeout: 5000 });
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '我的' }).last().click();
    await page.getByRole('button', { name: '清空本机全部数据' }).click();
    await page.getByText('先告诉我们你的身份').waitFor({ state: 'visible', timeout: 10000 });
    check('清空本机数据后回到首启选择（删档重来）', true);
    await context.close();
  }

  // ===== 场景 D（P1 遗留）：demo 会话遗留的事件/聊天不得继承给新建的个人档案 =====
  // 泄漏入口：档案失效（旧版本/坏数据被 isValidStoredProfile 视为无档案）但事件
  // 存储还在 → 启动 hydrate 把 demo 遗留当"用户自己的记录"恢复 → 建档张爷爷后
  // 继承王秀兰的全部演示信号。修复 = 建档完成时清空遗留快照并归零会话内存。
  {
    const context = await browser.newContext({ locale: 'zh-CN' });
    const page = await context.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    // demo 会话说一句话，让事件与聊天经 save effect 落盘
    await page.getByRole('button', { name: /老人端/ }).click();
    await page.getByRole('button', { name: /体验王秀兰演示档案/ }).click();
    await page.locator('.elder-welcome h1').waitFor({ state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /打字聊天/ }).click();
    const demoInput = page.locator('#elder-chat input.chat-input');
    await demoInput.waitFor({ timeout: 5000 });
    await demoInput.fill('演示期间的心跳很快');
    await page.locator('#elder-chat button', { hasText: '发送' }).click();
    await page.waitForTimeout(1500);
    // 模拟档案失效：只丢档案键，事件存储原样保留，刷新后回到首启选择
    await page.evaluate(() => localStorage.removeItem('ankang-route1-profile-v1'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('先告诉我们你的身份').waitFor({ state: 'visible', timeout: 10000 });
    // 新建个人档案
    await page.getByRole('button', { name: /老人端/ }).click();
    await page.getByRole('button', { name: /创建真实档案/ }).click();
    await page.getByRole('button', { name: /暂不登录，先创建本机档案/ }).click();
    await page.getByText('先认识一下您').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('#profile-name').fill('张爷爷');
    await page.getByRole('button', { name: '好了，开始使用' }).click();
    await page.locator('.elder-welcome h1').waitFor({ state: 'visible', timeout: 5000 });
    // 泄漏的可见面在聊天视图（历史气泡）与健康信号，不在首页欢迎语
    await page.getByRole('button', { name: /打字聊天/ }).click();
    await page.locator('#elder-chat input.chat-input').waitFor({ timeout: 5000 });
    const chatBody = await page.locator('body').innerText();
    check(
      '个人建档不继承 demo 会话的事件与聊天（P1 泄漏回归）',
      !chatBody.includes('王秀兰') && !chatBody.includes('演示期间的心跳很快'),
    );
    // 清空之后保存管线必须仍然健康：个人会话的新聊天正常持久化（已在聊天视图内）
    const personalInput = page.locator('#elder-chat input.chat-input');
    await personalInput.waitFor({ timeout: 5000 });
    await personalInput.fill('个人会话的第一句话');
    await page.locator('#elder-chat button', { hasText: '发送' }).click();
    await page.waitForTimeout(1200);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const elderGateBtn = page.getByRole('button', { name: /我是老人/ });
    if (await elderGateBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await elderGateBtn.click();
      await page.waitForTimeout(500);
    }
    await page.getByRole('button', { name: /打字聊天/ }).click();
    const bodyAfterReload = await page.evaluate(() => document.body.innerText);
    check('清空后个人会话持久化仍然健康（刷新不丢新聊天）', bodyAfterReload.includes('个人会话的第一句话'));
    await context.close();
  }

  await browser.close();
}

async function main() {
  // 测试构建必须剥离理解层 LLM 配置，避免任何聊天路径真的调用外部模型。
  const stripLlmEnv = { VITE_UNDERSTANDING_LLM_API_KEY: '', VITE_UNDERSTANDING_LLM_BASE_URL: '' };
  await run(NPM, ['run', 'build'], stripLlmEnv);
  await startPreview();
  try {
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
