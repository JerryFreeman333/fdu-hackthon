/**
 * 评审 P0-6/P1-3 回归（浏览器黑盒）：微信 webhook 通知通道。
 * 拦截对 Server酱 的真实请求，锁定四件事：
 * 1. 家属绑定后派发的紧急通知会同时调用微信推送，送达台账如实记录"微信推送已送达"；
 * 2. 绑定后的"数据与设置"里能看到已配置状态，测试消息真的发出并返回 ✅；
 * 3. 配置了微信推送时，老人端 SOS 卡出现"微信通知家属"按钮，点击后推送真的发出；
 * 4. 未绑定的家属端只有绑定卡，看不到设置区（这正是上一版测试超时的原因，
 *    所以流程改为：先种配置 → 走完整绑定 → 再回来断言设置卡）。
 */
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PROFILE_STORAGE_KEY } from './helpers/demo-seed.mjs';
import { startPreview as startPreviewShared } from './helpers/preview-server.mjs';

/** 个人模式种子：空数据起步——demo 预绑定会让真实派发引擎旁路，改走个人拓扑。 */
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PORT = Number(process.env.WEBHOOK_PORT ?? 4179);
const BASE = `http://localhost:${PORT}`;
const WEBHOOK_STORAGE_KEY = 'ankang-route1-webhook-push-v1';
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

let previewHandle = null;
const results = [];

function log(...args) {
  console.log('[webhook-blackbox]', ...args);
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

async function elderHomeNav(page) {
  await page.getByRole('navigation').getByRole('button', { name: '首页' }).click();
  await wait(400);
}

async function runWebhookSuite() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'zh-CN' });
  await context.grantPermissions(['notifications'], { origin: BASE });
  const page = await context.newPage();
  await page.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {}
    },
    [PROFILE_STORAGE_KEY, JSON.stringify(PERSONAL_SEED)],
  );
  // 家属端未绑定时只渲染"先完成家庭绑定"卡并提前 return，设置区在绑定后的主视图里。
  // 所以不走 UI 配置，而是在应用脚本运行前把配置种进 localStorage（等同"已配置过"）。
  await page.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {}
    },
    [WEBHOOK_STORAGE_KEY, JSON.stringify({ provider: 'serverchan', token: 'SCT-TEST-KEY' })],
  );
  page.on('pageerror', (err) => log('pageerror:', err.message));

  // 拦截 Server酱请求：记录调用并返回成功，测试不打真实微信。
  const webhookCalls = [];
  await page.route('**sctapi.ftqq.com/**', async (route) => {
    webhookCalls.push(route.request().postData() ?? '');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 0 }) });
  });

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

  try {
    // 1. 老人端：同意共享、生成邀请码（派发门控要求 granted + 绑定）。
    await page
      .getByRole('button', { name: /我是老人/ })
      .first()
      .click({ timeout: 5000 });
    // 个人模式：我的 → 允许共享（真实授权位 granted，派发门控要求）
    await page.getByRole('button', { name: '我的' }).last().click();
    await page
      .getByRole('button', { name: /允许共享/ })
      .first()
      .click({ timeout: 5000 });
    // 通过真实聊天产生一条可派发的急症发现（个人模式无合成种子）
    await elderHomeNav(page);
    await page.getByRole('button', { name: /打字聊天/ }).click();
    const fallInput = page.locator('#elder-chat input.chat-input');
    await fallInput.waitFor({ timeout: 5000 });
    await fallInput.fill('我刚才在卫生间摔了一跤，现在胸口有点疼');
    await page.locator('#elder-chat button', { hasText: '发送' }).click();
    await page.getByRole('button', { name: '返回首页' }).click();
    await wait(500);
    await page.getByRole('button', { name: '我的' }).last().click();
    await page
      .getByRole('button', { name: /生成家属邀请码/ })
      .first()
      .click({ timeout: 5000 });
    await page
      .getByText(/AN-\d{4}-[A-Z2-9]{10}/)
      .first()
      .waitFor({ state: 'visible', timeout: 5000 });
    const inviteCode = await page.evaluate(() => {
      const match = document.body.innerText.match(/AN-\d{4}-[A-Z2-9]{10}/);
      return match ? match[0] : null;
    });
    check('老人端同意共享并生成邀请码', Boolean(inviteCode), inviteCode ?? '未找到');
    if (!inviteCode) throw new Error('邀请码未生成，后续流程无法继续');

    // 2. 切到家属端：输入码、绑定；绑定后派发引擎开始工作。
    await page
      .getByRole('button', { name: /切换身份/ })
      .first()
      .click();
    await page
      .getByRole('button', { name: /我是家属/ })
      .first()
      .click({ timeout: 5000 });
    await page.locator('input[placeholder*="AN-"]').first().fill(inviteCode);
    await page.getByRole('button', { name: '绑定', exact: true }).first().click();
    // 绑定激活派发闸门 → 去消息页等台账出现微信推送记录（sendWebhookPush 是异步 fetch）。
    await page.getByRole('navigation').getByRole('button', { name: '消息' }).click();
    await page.getByText('微信推送已送达').first().waitFor({ state: 'visible', timeout: 15000 });

    // 3. 派发断言：Server酱真的被调了，台账如实记录。
    check('紧急通知派发时调用了微信推送通道', webhookCalls.length >= 1, `调用 ${webhookCalls.length} 次`);
    if (webhookCalls.length > 0) {
      // Server酱走 form-encoded：title=告警标题、desp=告警正文，两者都必须真的带上内容。
      const form = new URLSearchParams(webhookCalls[0]);
      const title = form.get('title') ?? '';
      const desp = form.get('desp') ?? '';
      check(
        '推送正文携带告警标题与正文',
        title.trim().length > 0 && desp.trim().length > 0,
        `title="${title.slice(0, 40)}" desp="${desp.slice(0, 40)}"`,
      );
    }
    const ledgerText = await page.locator('body').innerText();
    check('送达台账如实记录微信推送结果', /微信推送已送达/.test(ledgerText));

    // 4. 绑定后在"我的 → 隐私设置"里管理通知方式。
    await page.getByRole('button', { name: '我的' }).last().click();
    await page
      .getByRole('button', { name: /隐私设置/ })
      .first()
      .click();
    const settingsCard = page.locator('.webhook-settings-card');
    await settingsCard.waitFor({ state: 'visible', timeout: 5000 });
    check('绑定后可见微信推送设置卡', await settingsCard.isVisible());
    check('设置卡如实显示已配置状态', /当前已配置微信推送/.test(await settingsCard.innerText()));
    await settingsCard.locator('#webhook-token').fill('SCT-SECOND-KEY');
    await settingsCard.getByRole('button', { name: '发送测试消息' }).click();
    await settingsCard
      .locator('.webhook-status')
      .filter({ hasText: '✅' })
      .waitFor({ state: 'visible', timeout: 15000 });
    check('测试消息真实发出并返回成功', webhookCalls.length >= 2, `累计调用 ${webhookCalls.length} 次`);

    // 5. 老人端 SOS：配置了微信推送后出现"微信通知家属"按钮，点击推送真的发出。
    await page
      .getByRole('button', { name: /切换身份/ })
      .first()
      .click();
    await page
      .getByRole('button', { name: /我是老人/ })
      .first()
      .click({ timeout: 5000 });
    await page.getByRole('button', { name: '紧急求助' }).click();
    const sosNotifyBtn = page.locator('.sos-notify-btn');
    await sosNotifyBtn.waitFor({ state: 'visible', timeout: 5000 });
    check('老人端 SOS 卡出现微信通知家属按钮', await sosNotifyBtn.isVisible());
    const callsBeforeSos = webhookCalls.length;
    await sosNotifyBtn.click();
    await page
      .locator('.toast')
      .filter({ hasText: '已通过微信通知家属' })
      .waitFor({ state: 'visible', timeout: 15000 });
    check('SOS 微信通知真实发出并如实提示', webhookCalls.length > callsBeforeSos, `累计调用 ${webhookCalls.length} 次`);
  } catch (err) {
    log('错误:', err instanceof Error ? err.message : String(err));
    check('完成所有断言', false, err instanceof Error ? err.message : String(err));
  } finally {
    await page.screenshot({ path: resolve(ROOT, 'tests', 'webhook-blackbox.png'), fullPage: true }).catch(() => {});
    await context.close();
    await browser.close();
  }
}

async function main() {
  const stripLlmEnv = { VITE_UNDERSTANDING_LLM_API_KEY: '', VITE_UNDERSTANDING_LLM_BASE_URL: '' };
  await run(NPM, ['run', 'build'], stripLlmEnv);
  await startPreview();
  try {
    await runWebhookSuite();
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
