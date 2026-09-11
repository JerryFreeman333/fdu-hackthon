import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const BASE_URL = 'http://127.0.0.1:5173';
const BROWSER_LAUNCH_TIMEOUT_MS = 15_000;
const CASE_TIMEOUT_MS = 20_000;
// CI 提供系统 Chrome；本地开发可用 P0_CHROME_PATH 覆盖以复用本机浏览器。
const SYSTEM_CHROME = process.env.P0_CHROME_PATH ?? '/usr/bin/google-chrome';

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

async function newPage(context) {
  const page = await context.newPage();
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

async function elderChat(page, message) {
  const input = page.locator('#elder-chat input.chat-input');
  await input.waitFor();
  await input.fill(message);
  await page.locator('#elder-chat button', { hasText: '发送' }).click();
  await page.waitForTimeout(500);
}

async function generateInvite(page) {
  const button = page.locator('button', { hasText: '生成家属邀请码' });
  await button.waitFor();
  await button.click();
  const match = (await bodyText(page)).match(/AN-\d{4}-\d{4}/);
  assert(match, 'elder invite code was not generated');
  return match[0];
}

async function bindFamily(page, invite) {
  await chooseRole(page, '我是家属');
  const input = page.locator('.family-dashboard input.chat-input');
  await input.waitFor();
  await input.fill(invite);
  await page.locator('.family-dashboard button', { hasText: '绑定' }).click();
  await page.waitForTimeout(250);
  const text = (await page.locator('.family-dashboard').textContent()) ?? '';
  assert(text.includes('家属端'), 'family binding did not leave the binding gate');
  return text;
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
  const context = await browser.newContext();
  try {
    const page = await newPage(context);
    await chooseRole(page, '我是家属');
    const dashboard = page.locator('.family-dashboard');
    await dashboard.waitFor();
    const text = (await dashboard.textContent()) ?? '';
    assert(text.includes('先完成家庭绑定'), 'family binding gate is missing');
    return 'PASS family dashboard';
  } finally {
    await context.close();
  }
}

async function caseFamilyBinding(browser) {
  const context = await browser.newContext();
  try {
    const page = await newPage(context);
    await chooseRole(page, '我是老人');
    const invite = await generateInvite(page);
    await page.locator('button', { hasText: '切换身份' }).click();
    const text = await bindFamily(page, invite);
    assert(text.includes('现在最需要知道的'), 'bound dashboard content is missing');
    return 'PASS family binding';
  } finally {
    await context.close();
  }
}

async function caseFamilyRevocation(browser) {
  const context = await browser.newContext();
  try {
    const page = await newPage(context);
    await chooseRole(page, '我是老人');
    await elderChat(page, '我刚刚摔倒了');

    const share = page.locator('button', {
      hasText: '同意以后需要时告诉家属',
    });
    await share.waitFor();
    await share.click();
    assert(
      (await bodyText(page)).includes('已允许必要的家属协同'),
      'family sharing was not granted',
    );

    const invite = await generateInvite(page);
    await page.locator('button', { hasText: '切换身份' }).click();
    await bindFamily(page, invite);
    await page.locator('button', { hasText: '切换身份' }).click();
    await chooseRole(page, '我是老人');

    const revoke = page.locator('button', { hasText: '暂停家属共享' });
    await revoke.waitFor();
    await revoke.click();
    const elderState = page.locator('body');
    await elderState.getByText('暂不共享给家属').waitFor();
    assert(
      (await page.locator('button', { hasText: '暂停家属共享' }).count()) === 0,
      'revoke control remained visible',
    );

    await page.locator('button', { hasText: '切换身份' }).click();
    await chooseRole(page, '我是家属');
    const familyHeader = page.locator('.persona-sub');
    await familyHeader.waitFor();
    const headerText = (await familyHeader.textContent()) ?? '';
    assert(
      headerText.includes('绑定关系：家属'),
      'family binding was removed unexpectedly',
    );

    const pageText = (await bodyText(page)) ?? '';
    assert(
      pageText.includes('今天总体正常') || pageText.includes('目前没有新的家属通知'),
      'revoked family dashboard did not render the safe home state',
    );
    assert(
      !pageText.includes('我刚刚摔倒了') || !pageText.includes('需要马上确认安全情况'),
      'revoked urgent family content is still visible',
    );

    const detailButton = page.locator('button', { hasText: '查看共享摘要' });
    if (await detailButton.count()) {
      await detailButton.click();
      await page.waitForTimeout(150);
    }
    const detailText = (await bodyText(page)) ?? '';
    assert(
      detailText.includes('当前未共享详细健康资料'),
      'revoked family detail did not fail closed',
    );
    return 'PASS family revocation';
  } finally {
    await context.close();
  }
}

async function caseOneTimeSharePersistence(browser) {
  const context = await browser.newContext();
  try {
    const page = await newPage(context);
    await chooseRole(page, '我是老人');
    await elderChat(page, '我刚才摔了一跤，告诉女儿一声');
    assert(
      (await bodyText(page)).includes('分享给家属一次'),
      'one-time share receipt was not shown to the elder',
    );

    const invite = await generateInvite(page);
    await page.locator('button', { hasText: '切换身份' }).click();
    const boundText = await bindFamily(page, invite);
    assert(
      boundText.includes('老人报告刚刚跌倒') || boundText.includes('发生跌倒'),
      'one-time shared urgent finding was not visible to the bound family',
    );

    // 关键回归：一次性共享不得在家属端挂载帧内被"消费"掉——多等一拍后必须仍然可见。
    await page.waitForTimeout(1000);
    const laterText = (await bodyText(page)) ?? '';
    assert(
      laterText.includes('老人报告刚刚跌倒') || laterText.includes('发生跌倒'),
      'one-time share disappeared from the family view after render',
    );
    return 'PASS one-time share persistence';
  } finally {
    await context.close();
  }
}

async function caseFamilySessionReset(browser) {
  const context = await browser.newContext();
  try {
    const page = await newPage(context);
    await chooseRole(page, '我是老人');
    const share = page.locator('button', {
      hasText: '同意以后需要时告诉家属',
    });
    if (await share.isVisible().catch(() => false)) await share.click();
    const invite = await generateInvite(page);
    await page.locator('button', { hasText: '切换身份' }).click();
    await bindFamily(page, invite);

    await page.reload({
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    });
    await page.locator('button.role-option', { hasText: '我是老人' }).waitFor();
    await page.locator('button.role-option', { hasText: '我是家属' }).waitFor();
    const text = await bodyText(page);
    assert(!text.includes('本地演示家属'), 'family binding survived reload');
    assert(!text.includes('已允许必要的家属协同'), 'family consent survived reload');
    return 'PASS family session reset';
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
  caseOneTimeSharePersistence,
  caseFamilySessionReset,
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
