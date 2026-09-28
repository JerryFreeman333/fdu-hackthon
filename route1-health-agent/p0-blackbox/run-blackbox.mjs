import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

import { seedDemoProfile, PROFILE_STORAGE_KEY } from '../tests/helpers/demo-seed.mjs';
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const BASE_URL = 'http://127.0.0.1:5173';
const BROWSER_LAUNCH_TIMEOUT_MS = 15_000;
const CASE_TIMEOUT_MS = 45_000;
// CI 提供系统 Chrome；本地开发可用 P0_CHROME_PATH 覆盖以复用本机浏览器。
const SYSTEM_CHROME = process.env.P0_CHROME_PATH ?? '/usr/bin/google-chrome';

/**
 * 个人模式种子：未绑定、未授权——邀请码绑定、撤销授权、一次性共享
 * 都必须从这张白纸开始；demo 档案预绑定会绕过这些链路。
 */
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

function seedPersonalProfile(pageOrContext) {
  return pageOrContext.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {}
    },
    [PROFILE_STORAGE_KEY, JSON.stringify(PERSONAL_SEED)],
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function bodyText(page) {
  return page.locator('body').textContent();
}

function withFailFastTimeout(promise, timeoutMs, label) {
  const timer = setTimeout(() => {
    console.error(`FAIL ${label} exceeded ${timeoutMs / 1000}s`);
    process.exit(1);
  }, timeoutMs);
  return promise.finally(() => clearTimeout(timer));
}

async function waitForServer(timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
    } catch {
      // Keep polling until Vite is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Vite dev server did not become ready');
}

/** 跨 tab / 跨组件同步是异步的：轮询断言直到为真或超时，绝不固定单次等待。 */
async function waitFor(fn, timeoutMs = 10000, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs;
  let last = false;
  while (Date.now() < deadline) {
    last = await fn().catch(() => false);
    if (last) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return last;
}

async function newPage(context, seed = seedDemoProfile) {
  const page = await context.newPage();
  seed(page);
  page.setDefaultTimeout(5000);
  await page.goto(BASE_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 10000,
  });
  await page.locator('button.role-option', { hasText: '我是老人' }).waitFor();
  await page.locator('button.role-option', { hasText: '我是家属' }).waitFor();
  assert(
    !(await bodyText(page)).includes('Internal Server Error'),
    'startup rendered an Internal Server Error',
  );
  return page;
}

async function chooseRole(page, role) {
  const option = page.locator('button.role-option', { hasText: role });
  await option.waitFor();
  await option.click();
}

async function enterElderChat(page) {
  const input = page.locator('#elder-chat input.chat-input');
  if (await input.isVisible().catch(() => false)) return input;
  await page.getByRole('button', { name: /打字聊天/ }).click();
  await input.waitFor();
  return input;
}

async function elderChat(page, message) {
  const input = await enterElderChat(page);
  await input.fill(message);
  await page.locator('#elder-chat button', { hasText: '发送' }).click();
  await page.waitForTimeout(800);
}

async function generateInvite(page) {
  await page.getByRole('button', { name: '我的' }).last().click();
  const button = page.getByRole('button', { name: /生成家属邀请码/ });
  await button.waitFor();
  await button.click();
  await page.waitForTimeout(500);
  const match = (await bodyText(page)).match(/AN-\d{4}-[A-Z2-9]{10}/);
  assert(match, 'elder invite code was not generated');
  return match[0];
}

/**
 * 家属 tab 输码绑定。绑定走 family.link 握手（老人端实例在线应答），
 * 所以老人端 tab 必须保持打开——本 tab 切角色后再绑是重构后的死架构，不再支持。
 */
async function bindFamilyTab(familyPage, invite) {
  await chooseRole(familyPage, '我是家属');
  const input = familyPage.locator('.family-dashboard input.chat-input');
  await input.waitFor();
  await input.fill(invite);
  await familyPage.locator('.family-dashboard button', { hasText: '绑定' }).click();
  await familyPage
    .getByText('已通过邀请码绑定的家属')
    .first()
    .waitFor({ state: 'visible', timeout: 15000 });
}

async function caseStartup(browser) {
  const context = await browser.newContext();
  try {
    await newPage(context);
    return 'PASS startup';
  } finally {
    await context.close();
  }
}

async function caseElderSmoke(browser) {
  const context = await browser.newContext();
  try {
    const page = await newPage(context);
    await chooseRole(page, '我是老人');
    await elderChat(page, '我觉得他喘得厉害');
    assert(
      (await bodyText(page)).includes('我觉得他喘得厉害'),
      'elder smoke message was not rendered',
    );
    return 'PASS elder smoke';
  } finally {
    await context.close();
  }
}

async function caseFamilySmoke(browser) {
  // demo 档案预绑定：家属端直接进入 dashboard，不再停在绑定门
  const demoContext = await browser.newContext();
  try {
    const page = await newPage(demoContext);
    await chooseRole(page, '我是家属');
    const dashboard = page.locator('.family-dashboard');
    await dashboard.waitFor();
    const text = (await dashboard.textContent()) ?? '';
    assert(!text.includes('先完成家庭绑定'), 'demo family dashboard should be pre-bound');
  } finally {
    await demoContext.close();
  }

  // personal 档案未绑定：家属端必须停在绑定门（fail-closed 的第一道闸）
  const personalContext = await browser.newContext();
  try {
    const page = await newPage(personalContext, seedPersonalProfile);
    await chooseRole(page, '我是家属');
    await page.getByText('先完成家庭绑定').first().waitFor({ state: 'visible', timeout: 8000 });
    return 'PASS family dashboard';
  } finally {
    await personalContext.close();
  }
}

async function caseFamilyBinding(browser) {
  const context = await browser.newContext();
  try {
    seedPersonalProfile(context);
    const elderPage = await context.newPage();
    const familyPage = await context.newPage();
    await elderPage.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await familyPage.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });

    await chooseRole(elderPage, '我是老人');
    const invite = await generateInvite(elderPage);
    await bindFamilyTab(familyPage, invite);
    assert(
      await familyPage.locator('.family-dashboard').isVisible(),
      'family dashboard did not render after binding',
    );
    return 'PASS family binding';
  } finally {
    await context.close();
  }
}

async function caseFamilyRevocation(browser) {
  const context = await browser.newContext();
  try {
    seedPersonalProfile(context);
    const elderPage = await context.newPage();
    const familyPage = await context.newPage();
    await elderPage.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await familyPage.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });

    // 老人端：先授权共享（派发引擎只对授权后的发现派发），生成邀请码
    await chooseRole(elderPage, '我是老人');
    await elderPage.getByRole('button', { name: '我的' }).last().click();
    await elderPage.getByRole('button', { name: /允许共享/ }).click();
    assert(
      await waitFor(() => elderPage.getByRole('button', { name: /暂停共享/ }).isVisible()),
      'elder consent did not take effect',
    );
    const invite = await generateInvite(elderPage);

    // 家属端：绑定后，老人端报急症，首页必须看到急症介入状态（跨端协同建立）
    await bindFamilyTab(familyPage, invite);
    await familyPage.getByRole('navigation').getByRole('button', { name: '首页' }).click();
    await elderPage.getByRole('navigation').getByRole('button', { name: '首页' }).click();
    await elderPage.getByRole('button', { name: /打字聊天/ }).click();
    await elderChat(elderPage, '我刚刚摔倒了');
    const urgentVisible = await waitFor(() =>
      familyPage
        .locator('body')
        .innerText()
        .then((t) => t.includes('需要立即介入') || t.includes('发生跌倒')),
    );
    assert(urgentVisible, 'bound family home did not show the urgent intervention state');

    // 老人端撤销共享 → 家属端必须收敛到撤销后的授权（远端授权是唯一权威），
    // 且撤销后的新急症绝不派发给家属（撤销 toast 的承诺："之后的新变化不会继续
    // 提供给家属"）。撤销前已送达的通知留在台账里是历史记录，不在此断言。
    await elderPage.getByRole('button', { name: /返回首页/ }).click();
    await elderPage.getByRole('navigation').getByRole('button', { name: '我的' }).click();
    await elderPage.getByRole('button', { name: /暂停共享/ }).click();
    const converged = await waitFor(() =>
      familyPage
        .evaluate(() => {
          try {
            return JSON.parse(localStorage.getItem('ankang-route1-family-state-v1') ?? '{}').familySharing;
          } catch {
            return null;
          }
        })
        .then((v) => v === 'denied'),
    );
    assert(converged, 'family side did not adopt the revoked consent');

    await elderPage.getByRole('navigation').getByRole('button', { name: '首页' }).click();
    await elderChat(elderPage, '我现在胸口很闷');
    await familyPage.getByRole('navigation').getByRole('button', { name: '消息' }).click();
    const leaked = await waitFor(
      () => familyPage.locator('body').innerText().then((t) => t.includes('胸')),
      6000,
      500,
    );
    assert(leaked === false, 'post-revocation urgent event was still dispatched to the family');
    return 'PASS family revocation';
  } finally {
    await context.close();
  }
}

async function caseFamilyMedicationView(browser) {
  const context = await browser.newContext();
  try {
    const page = await newPage(context);
    await chooseRole(page, '我是老人');
    await elderChat(page, '我刚刚摔倒了');
    await page.getByRole('button', { name: /返回首页/ }).click();
    // demo 档案预绑定：授权卡片直接点击即建立持久授权
    const share = page.locator('button', { hasText: '告诉家属' });
    await share.waitFor();
    await share.click();
    await page.waitForTimeout(500);

    await generateInvite(page);
    await page.locator('button', { hasText: '切换身份' }).click();
    await chooseRole(page, '我是家属');
    await page.waitForTimeout(800);

    // 家属端"我的 → 隐私设置 → 用药与医护"：授权后可见父母药物档案（剂量/频次）
    await page.getByRole('button', { name: '我的' }).last().click();
    await page
      .getByRole('button', { name: /隐私设置/ })
      .first()
      .click();
    const medTab = page.locator('.settings-list button', { hasText: '用药与医护' });
    await medTab.waitFor();
    await medTab.click();
    await page.waitForTimeout(300);
    const medText = (await bodyText(page)) ?? '';
    assert(medText.includes('氨氯地平'), 'granted family cannot see the medication list');
    assert(medText.includes('每日一次'), 'medication view did not show dose and frequency');

    // 撤销授权后，用药页必须 fail-closed：只显示隐私卡，不泄露任何药名。
    await page.locator('button', { hasText: '← 返回' }).click();
    await page.waitForTimeout(200);
    await page
      .getByRole('button', { name: /隐私设置/ })
      .first()
      .click();
    const revoke = page.locator('button', { hasText: '暂停老人共享' });
    await revoke.waitFor();
    await revoke.click();
    await page.waitForTimeout(300);
    await page.locator('.settings-list button', { hasText: '用药与医护' }).click();
    await page.waitForTimeout(300);
    const revokedText = (await bodyText(page)) ?? '';
    assert(
      revokedText.includes('老人尚未授权家属查看详细用药信息') && !revokedText.includes('氨氯地平'),
      'medication view did not fail closed after revocation',
    );
    return 'PASS family medication view';
  } finally {
    await context.close();
  }
}

async function caseOneTimeSharePersistence(browser) {
  const context = await browser.newContext();
  try {
    const page = await newPage(context, seedPersonalProfile);
    await chooseRole(page, '我是老人');
    await elderChat(page, '我刚才摔了一跤，告诉女儿一声');
    assert(
      (await bodyText(page)).includes('分享给家属一次'),
      'one-time share receipt was not shown to the elder',
    );
    return 'PASS one-time share persistence';
  } finally {
    await context.close();
  }
}

async function casePhotoDemoImport(browser) {
  const context = await browser.newContext();
  try {
    const page = await newPage(context);
    await chooseRole(page, '我是老人');
    // 照片导入在"健康档案"页：先展开"健康数据与图片识别"折叠区（ElderHealthPage 所在），
    // 拍照区是 .capture-actions 下的隐藏 input；确认卡 .photo-confirm-card 由解析结果渲染。
    await page.getByRole('navigation').getByRole('button', { name: '健康档案' }).click();
    await page.locator('details.archive-health > summary', { hasText: '健康数据与图片识别' }).click();
    const fileInput = page.locator('.capture-actions input[type=file]');
    await fileInput.waitFor({ state: 'attached' });
    await fileInput.setInputFiles({
      name: 'bp.png',
      mimeType: 'image/png',
      // 1x1 PNG；Demo parser 不读像素，只走"选择 → 确认"的完整链路。
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
    const confirmCard = page.locator('.photo-confirm-card');
    await confirmCard.waitFor();
    assert(
      (await bodyText(page)).includes('识别到这些内容'),
      'parsed photo confirmation card is missing',
    );
    await page.locator('button', { hasText: '确认并记录' }).click();
    await page.waitForTimeout(500);
    assert(
      (await bodyText(page)).includes('已记录 2 项'),
      'confirmed photo import did not record the parsed values',
    );
    return 'PASS photo demo import';
  } finally {
    await context.close();
  }
}

async function caseSessionPersistenceAcrossReload(browser) {
  const context = await browser.newContext();
  try {
    const page = await newPage(context);
    await chooseRole(page, '我是老人');
    await page.getByRole('button', { name: '我的' }).last().click();
    await page.getByRole('button', { name: /允许共享/ }).click();
    assert(
      await waitFor(() => page.getByRole('button', { name: /暂停共享/ }).isVisible()),
      'consent toggle did not switch to 暂停共享',
    );

    // P0-2 修复后绑定/授权持久化：刷新后授权必须仍在（旧断言"必须清空"已反转）。
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
    const elderGateBtn = page.getByRole('button', { name: /我是老人/ });
    if (await elderGateBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await elderGateBtn.click();
      await page.waitForTimeout(500);
    }
    await page.getByRole('button', { name: '我的' }).last().click();
    assert(
      await waitFor(() => page.getByRole('button', { name: /暂停共享/ }).isVisible()),
      'family consent did not survive reload',
    );
    return 'PASS session persistence across reload';
  } finally {
    await context.close();
  }
}

async function runCase(test, browser) {
  return withFailFastTimeout(test(browser), CASE_TIMEOUT_MS, test.name);
}

const cases = [
  caseStartup,
  caseElderSmoke,
  caseFamilySmoke,
  caseFamilyBinding,
  caseFamilyRevocation,
  caseFamilyMedicationView,
  caseOneTimeSharePersistence,
  casePhotoDemoImport,
  caseSessionPersistenceAcrossReload,
];

const vite = spawn(
  'npm',
  ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173'],
  {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
vite.stdout.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`));
vite.stderr.on('data', (chunk) => process.stderr.write(`[vite-err] ${chunk}`));

try {
  await waitForServer();
  console.log('START browser');
  const browser = await withFailFastTimeout(
    chromium.launch({
      headless: true,
      executablePath: SYSTEM_CHROME,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    }),
    BROWSER_LAUNCH_TIMEOUT_MS,
    'browser launch',
  );
  const results = [];
  for (const test of cases) {
    console.log(`START ${test.name}`);
    try {
      const result = await runCase(test, browser);
      results.push(result);
      console.log(result);
    } catch (error) {
      const message = String(error).slice(0, 400);
      results.push(`FAIL ${message}`);
      console.error(`FAIL ${message}`);
    }
  }
  const allPass =
    results.length === cases.length &&
    results.every((result) => result.startsWith('PASS '));
  console.log(`ROUTE 1 BLACKBOX: ${allPass ? 'ALL PASS' : 'NOT PASSING'}`);
  vite.kill('SIGTERM');
  process.exit(allPass ? 0 : 1);
} catch (error) {
  console.error(`FAIL ${String(error).slice(0, 400)}`);
  vite.kill('SIGTERM');
  process.exit(1);
}
