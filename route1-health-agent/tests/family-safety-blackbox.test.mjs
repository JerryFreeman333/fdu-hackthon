/**
 * 浏览器黑盒：家人安全事件是否真的变成家属侧的一条急症通知。
 *
 * 覆盖用户确认的产品决策：
 * - 五类家人安全事件全部保持"紧急"，黑便不降级；
 * - 必须接入系统通知/微信推送台账，而不只是在家属页面上画一张卡；
 * - 家属首页状态与"现在最需要知道的"必须把它当成当前急症。
 *
 * 修复前：家人事件只在同一个 React 实例切换角色时可见，从不进入
 * collectFamilyNotifications / dispatch 台账，家属端拿不到任何通知记录。
 */
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PROFILE_STORAGE_KEY } from './helpers/demo-seed.mjs';
import { startPreview as startPreviewShared } from './helpers/preview-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const PORT = Number(process.env.FAMILY_SAFETY_SMOKE_PORT ?? 4181);

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

let previewHandle = null;
const log = (...args) => console.log('[family-safety-smoke]', ...args);

function run(cmd, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolvePromise() : reject(new Error(`${cmd} exit ${code}`))));
    child.on('error', reject);
  });
}

async function main() {
  if (!existsSync(DIST) || !existsSync(resolve(DIST, 'index.html'))) {
    log('dist/ 不存在，先执行 npm run build …');
    await run('npm', ['run', 'build']);
  }
  previewHandle = await startPreviewShared({ port: PORT, prefix: '[preview]' });
  log(`preview 服务已就绪 (http://127.0.0.1:${PORT})`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  await context.route(/peerjs\.com/, (route) => route.abort());
  const webhookCalls = [];
  await context.route('https://www.pushplus.plus/send', async (route) => {
    webhookCalls.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 200 }) });
  });
  await context.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
        localStorage.setItem(
          'ankang-route1-webhook-push-v1',
          JSON.stringify({ provider: 'pushplus', token: 'local-test-token' }),
        );
      } catch {}
    },
    [PROFILE_STORAGE_KEY, JSON.stringify(PERSONAL_SEED)],
  );
  await context.addInitScript(() => {
    window.__safetyPushCalls = [];
    class TestNotification {
      static permission = 'granted';
      static requestPermission = async () => 'granted';
      constructor(title, options) {
        window.__safetyPushCalls.push({ title, ...options });
      }
    }
    Object.defineProperty(window, 'Notification', { configurable: true, value: TestNotification });
  });

  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  };
  async function waitFor(fn, timeoutMs = 12000, intervalMs = 300) {
    const deadline = Date.now() + timeoutMs;
    let last = false;
    while (Date.now() < deadline) {
      last = await fn().catch(() => false);
      if (last) return true;
      await wait(intervalMs);
    }
    return last;
  }

  const elderTab = await context.newPage();
  elderTab.on('pageerror', (err) => log('pageerror(elder):', err.message));
  const familyTab = await context.newPage();
  familyTab.on('pageerror', (err) => log('pageerror(family):', err.message));
  for (const page of [elderTab, familyTab]) {
    await page.clock.install({ time: new Date('2026-11-16T15:58:00Z') });
  }

  try {
    await elderTab.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await elderTab.getByRole('button', { name: /我是老人/ }).click({ timeout: 5000 });
    await wait(600);

    await elderTab.getByRole('button', { name: '我的' }).last().click();
    await elderTab.getByRole('button', { name: /生成家属邀请码/ }).click();
    await wait(500);
    const inviteCode = await elderTab.evaluate(() => {
      const match = document.body.innerText.match(/AN-\d{4}-[A-Z2-9]{10}/);
      return match ? match[0] : null;
    });
    check('老人端生成邀请码', !!inviteCode, inviteCode || '未找到');
    if (!inviteCode) throw new Error('邀请码未生成');

    await familyTab.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await familyTab.getByRole('button', { name: /我是家属/ }).click({ timeout: 5000 });
    const inviteInput = familyTab.locator('.family-dashboard input.chat-input');
    await inviteInput.waitFor({ timeout: 5000 });
    await inviteInput.fill(inviteCode);
    await familyTab.locator('.family-dashboard button', { hasText: '绑定' }).click();
    await familyTab.getByText('已通过邀请码绑定的家属').first().waitFor({ state: 'visible', timeout: 10000 });
    check('家属端绑定成功', true);

    await elderTab.getByRole('button', { name: /允许共享/ }).click();
    await waitFor(() => elderTab.getByRole('button', { name: /暂停共享/ }).isVisible(), 5000);
    check('老人端授权共享', true);

    // 家人安全事件：黑便（用户明确要求不降级）。
    await elderTab.getByRole('navigation').getByRole('button', { name: '首页' }).click();
    await elderTab.getByRole('button', { name: /打字聊天/ }).click();
    const chatInput = elderTab.locator('#elder-chat input.chat-input');
    await chatInput.waitFor({ timeout: 5000 });
    await chatInput.fill('我爸刚才大便发黑，还头晕');
    await elderTab.locator('#elder-chat button', { hasText: '发送' }).click();

    await familyTab.getByRole('navigation').getByRole('button', { name: '首页' }).click();
    const safetyCardVisible = await waitFor(() => familyTab.getByText('家人安全提醒').first().isVisible(), 15000);
    check('家属首页出现家人安全提醒', safetyCardVisible);

    const homeText = await familyTab.locator('body').innerText();
    check('文案写明是老人转述，不把"父亲"读成家属自己的父亲', /老人转述/.test(homeText), '老人转述');
    check('黑便仍以"紧急"呈现，没有降级', /紧急/.test(homeText) && /黑便|便血/.test(homeText));
    check('首页状态不再说"今天还没有任何健康信号"', !homeText.includes('今天还没有任何健康信号'));
    check('"现在最需要知道的"把家人安全排在前面', homeText.includes('家人安全'));

    await familyTab.getByRole('navigation').getByRole('button', { name: '消息' }).click();
    const messageText = await familyTab.locator('body').innerText();
    check('通知台账里有这条家人安全事件', /家人安全提醒/.test(messageText) && /黑便|便血/.test(messageText));
    check(
      '台账记录了投递渠道，而不是只在页面画一张卡',
      /通知中心已送达/.test(messageText) && /(系统通知|微信推送)/.test(messageText),
      messageText.match(/送达状态：[^\n]*/)?.[0] ?? '',
    );
    check('家属设备弹出系统通知', await waitFor(() => familyTab.evaluate(() => window.__safetyPushCalls.length === 1)));
    check('老人端没有误弹家人事件通知', await elderTab.evaluate(() => window.__safetyPushCalls.length === 0));
    check('微信渠道实际发起请求', webhookCalls.length === 1);
    await familyTab.getByRole('button', { name: '我已知悉' }).first().click();
    const records = () =>
      elderTab.evaluate(() => JSON.parse(localStorage.getItem('ankang-route1-dispatch-records-v1') ?? '[]'));
    check(
      '昨天确认的事件保留确认状态',
      await waitFor(async () => (await records()).some((record) => record.lifecycle === 'acknowledged')),
    );
    await chatInput.fill('我母亲刚才摔了一跤');
    await elderTab.locator('#elder-chat button', { hasText: '发送' }).click();
    check(
      '另一条未确认安全事件已在当天推送',
      await waitFor(
        async () =>
          webhookCalls.length === 2 && (await familyTab.evaluate(() => window.__safetyPushCalls.length === 2)),
      ),
    );
    const unacknowledged = (await records()).find(
      (record) => record.lifecycle === 'new' && record.findingId.startsWith('family-safety:'),
    );
    if (!unacknowledged) throw new Error('未找到跨天重推用的未确认事件');

    for (const page of [familyTab, elderTab]) {
      await page.clock.setSystemTime(new Date('2026-11-16T16:01:00Z'));
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    }
    check(
      '本地日期跨午夜后，未确认事件再次推系统通知和微信',
      await waitFor(
        async () =>
          webhookCalls.length === 3 && (await familyTab.evaluate(() => window.__safetyPushCalls.length === 3)),
      ),
    );
    const repeated = (await records()).find((record) => record.findingId === unacknowledged.findingId);
    check(
      '重推保留首次报告时间并更新最近提醒时间',
      repeated?.createdAt === unacknowledged.createdAt && repeated?.updatedAt > unacknowledged.createdAt,
    );
    check('昨天已确认的黑便事件今天没有重推', webhookCalls.filter((call) => /黑便|便血/.test(call.title)).length === 1);
    check('今日重推正文仍保留昨天发生日期', /2026-11-16/.test(webhookCalls[2]?.content ?? ''));
    for (let index = 0; index < 3; index += 1) {
      await elderTab.evaluate(() => window.dispatchEvent(new Event('focus')));
    }
    await wait(800);
    check('同一天再次唤醒不会重复推送', webhookCalls.length === 3);
    await familyTab.getByRole('button', { name: '我已知悉' }).first().click();
    await waitFor(async () => (await records()).every((record) => record.lifecycle === 'acknowledged'));
    await elderTab.reload({ waitUntil: 'domcontentloaded' });
    await wait(800);
    check('已确认后刷新老人端不会重推', webhookCalls.length === 3);
  } finally {
    await browser.close();
    previewHandle?.stop();
  }

  const passed = results.filter((item) => item.ok).length;
  log(`总计: ${passed}/${results.length} 通过`);
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[family-safety-smoke] 失败:', error);
  previewHandle?.stop();
  process.exitCode = 1;
});
