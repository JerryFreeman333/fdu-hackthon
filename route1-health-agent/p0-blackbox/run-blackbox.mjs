import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const BASE_URL = 'http://127.0.0.1:5173';

async function waitForServer(timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Vite dev server did not become ready');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectRoleGate(page) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
  const elder = page.locator('button.role-option', { hasText: '我是老人' });
  const family = page.locator('button.role-option', { hasText: '我是家属' });
  await elder.waitFor({ state: 'visible', timeout: 5000 });
  await family.waitFor({ state: 'visible', timeout: 5000 });
  const body = (await page.locator('body').textContent()) ?? '';
  assert(!body.includes('Internal Server Error'), 'startup rendered an Internal Server Error');
}

async function caseStartup(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await expectRoleGate(page);
    return 'PASS startup';
  } finally {
    await context.close();
  }
}

async function caseElderSmoke(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await expectRoleGate(page);
    await page.locator('button.role-option', { hasText: '我是老人' }).click();
    await page.locator('#elder-chat input.chat-input').waitFor({ state: 'visible', timeout: 5000 });
    const input = page.locator('#elder-chat input.chat-input');
    await input.fill('我觉得他喘得厉害');
    await page.locator('#elder-chat button', { hasText: '发送' }).click();
    await page.waitForTimeout(500);
    const body = (await page.locator('body').textContent()) ?? '';
    assert(body.includes('我觉得他喘得厉害'), 'elder chat input flow did not render the sent message');
    return 'PASS elder smoke';
  } finally {
    await context.close();
  }
}

async function caseFamilySmoke(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await expectRoleGate(page);
    await page.locator('button.role-option', { hasText: '我是家属' }).click();
    const dashboard = page.locator('.family-dashboard');
    await dashboard.waitFor({ state: 'visible', timeout: 5000 });
    const text = (await dashboard.textContent()) ?? '';
    assert(text.includes('先完成家庭绑定'), 'family dashboard did not reach its binding gate');
    return 'PASS family dashboard';
  } finally {
    await context.close();
  }
}

async function caseFamilyBinding(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await expectRoleGate(page);
    await page.locator('button.role-option', { hasText: '我是老人' }).click();
    const inviteButton = page.locator('button', { hasText: '生成家属邀请码' });
    await inviteButton.waitFor({ state: 'visible', timeout: 5000 });
    await inviteButton.click();
    const elderBody = (await page.locator('body').textContent()) ?? '';
    const match = elderBody.match(/AN-\d{4}-\d{4}/);
    assert(match, 'elder invite code was not generated');
    const invite = match[0];
    await page.locator('button', { hasText: '切换身份' }).click();
    await page.locator('button.role-option', { hasText: '我是家属' }).click();
    const familyInput = page.locator('.family-dashboard input.chat-input');
    await familyInput.fill(invite);
    await page.locator('.family-dashboard button', { hasText: '绑定' }).click();
    await page.waitForTimeout(250);
    const text = (await page.locator('.family-dashboard').textContent()) ?? '';
    assert(text.includes('家属端'), 'family binding did not leave the binding gate');
    assert(text.includes('现在最需要知道的'), 'family dashboard did not render its real content after binding');
    return 'PASS family binding';
  } finally {
    await context.close();
  }
}

async function caseFamilyRevocation(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await expectRoleGate(page);
    await page.locator('button.role-option', { hasText: '我是老人' }).click();

    const elderChat = page.locator('#elder-chat input.chat-input');
    await elderChat.waitFor({ state: 'visible', timeout: 5000 });
    await elderChat.fill('我胸口痛');
    await page.locator('#elder-chat button', { hasText: '发送' }).click();

    const shareButton = page.locator('button', { hasText: '同意以后需要时告诉家属' });
    await shareButton.waitFor({ state: 'visible', timeout: 5000 });
    await shareButton.click();

    const elderGranted = (await page.locator('body').textContent()) ?? '';
    assert(elderGranted.includes('已允许必要的家属协同'), 'family sharing was not granted through the real user flow');

    const inviteButton = page.locator('button', { hasText: '生成家属邀请码' });
    await inviteButton.waitFor({ state: 'visible', timeout: 5000 });
    await inviteButton.click();
    const elderBody = (await page.locator('body').textContent()) ?? '';
    const match = elderBody.match(/AN-\d{4}-\d{4}/);
    assert(match, 'revocation probe failed to generate an invite');
    const invite = match[0];

    await page.locator('button', { hasText: '切换身份' }).click();
    await page.locator('button.role-option', { hasText: '我是家属' }).click();
    await page.locator('.family-dashboard input.chat-input').fill(invite);
    await page.locator('.family-dashboard button', { hasText: '绑定' }).click();
    await page.waitForTimeout(250);
    assert(
      ((await page.locator('body').textContent()) ?? '').includes('现在最需要知道的'),
      'revocation probe failed to bind family',
    );

    await page.locator('button', { hasText: '切换身份' }).click();
    await page.locator('button.role-option', { hasText: '我是老人' }).click();
    const revokeButton = page.locator('button', { hasText: '暂停家属共享' });
    await revokeButton.waitFor({ state: 'visible', timeout: 5000 });
    await revokeButton.click();

    const elderAfterRevoke = (await page.locator('body').textContent()) ?? '';
    assert(!elderAfterRevoke.includes('暂停家属共享'), 'revoke control remained visible after sharing was disabled');
    assert(elderAfterRevoke.includes('暂不共享给家属'), 'elder UI did not reflect revoked sharing state');

    await page.locator('button', { hasText: '切换身份' }).click();
    await page.locator('button.role-option', { hasText: '我是家属' }).click();
    await page.waitForTimeout(250);
    const familyAfterRevoke = (await page.locator('.family-dashboard').textContent()) ?? '';
    assert(familyAfterRevoke.includes('绑定关系：家属'), 'revocation unexpectedly removed the family binding itself');
    assert(
      familyAfterRevoke.includes('目前没有新的家属通知'),
      'revoked family session still exposed a family notification',
    );
    assert(
      !familyAfterRevoke.includes('居家安全，需要您做的一件事'),
      'revoked family session exposed home safety actions',
    );

    await page.locator('.family-dashboard button', { hasText: '查看共享摘要' }).click();
    await page.waitForTimeout(150);
    const detailAfterRevoke = (await page.locator('.family-dashboard').textContent()) ?? '';
    assert(detailAfterRevoke.includes('当前未共享详细健康资料'), 'revoked family detail view did not fail closed');

    return 'PASS family revocation';
  } finally {
    await context.close();
  }
}

async function caseFamilySessionReset(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await expectRoleGate(page);
    await page.locator('button.role-option', { hasText: '我是老人' }).click();
    const shareButton = page.locator('button', { hasText: '同意以后需要时告诉家属' });
    if (await shareButton.isVisible({ timeout: 1500 }).catch(() => false)) await shareButton.click();
    const inviteButton = page.locator('button', { hasText: '生成家属邀请码' });
    await inviteButton.waitFor({ state: 'visible', timeout: 5000 });
    await inviteButton.click();
    const elderBody = (await page.locator('body').textContent()) ?? '';
    const match = elderBody.match(/AN-\d{4}-\d{4}/);
    assert(match, 'session-isolation probe failed to generate an invite');
    const invite = match[0];

    await page.locator('button', { hasText: '切换身份' }).click();
    await page.locator('button.role-option', { hasText: '我是家属' }).click();
    await page.locator('.family-dashboard input.chat-input').fill(invite);
    await page.locator('.family-dashboard button', { hasText: '绑定' }).click();
    await page.waitForTimeout(200);
    assert(
      ((await page.locator('body').textContent()) ?? '').includes('现在最需要知道的'),
      'family session did not bind',
    );

    await page.reload({ waitUntil: 'networkidle' });
    const elderGate = page.locator('button.role-option', { hasText: '我是老人' });
    const familyGate = page.locator('button.role-option', { hasText: '我是家属' });
    await elderGate.waitFor({ state: 'visible', timeout: 5000 });
    await familyGate.waitFor({ state: 'visible', timeout: 5000 });
    const bodyAfterReload = (await page.locator('body').textContent()) ?? '';
    assert(!bodyAfterReload.includes('本地演示家属'), 'family binding survived page reload');
    assert(!bodyAfterReload.includes('已允许必要的家属协同'), 'family consent survived page reload');
    return 'PASS family session reset';
  } finally {
    await context.close();
  }
}

const vite = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
});
vite.stdout.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`));
vite.stderr.on('data', (chunk) => process.stderr.write(`[vite-err] ${chunk}`));

try {
  await waitForServer();
  const launchOptions = { headless: true };
  if (process.env.PLAYWRIGHT_BROWSER_CHANNEL) {
    launchOptions.channel = process.env.PLAYWRIGHT_BROWSER_CHANNEL;
  } else if (!process.env.PLAYWRIGHT_EXECUTABLE_PATH) {
    launchOptions.channel = 'chrome';
  } else {
    launchOptions.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  }
  const browser = await chromium.launch(launchOptions);
  const cases = [
    caseStartup,
    caseElderSmoke,
    caseFamilySmoke,
    caseFamilyBinding,
    caseFamilyRevocation,
    caseFamilySessionReset,
  ];
  const results = [];
  for (const test of cases) {
    try {
      const result = await test(browser);
      results.push({ result });
      console.log(result);
    } catch (error) {
      const message = String(error).slice(0, 400);
      results.push({ result: `FAIL ${message}` });
      console.error(`FAIL ${message}`);
    }
  }
  await browser.close();
  const allPass = results.length === cases.length && results.every(({ result }) => result.startsWith('PASS '));
  console.log(`ROUTE 1 BLACKBOX: ${allPass ? 'ALL PASS' : 'NOT PASSING'}`);
  process.exitCode = allPass ? 0 : 1;
} finally {
  vite.kill('SIGTERM');
}
