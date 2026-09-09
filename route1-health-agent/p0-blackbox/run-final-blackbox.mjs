import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASE_URL = 'http://127.0.0.1:5173';
const SCREENSHOT_DIR = path.join(import.meta.dirname, 'final-screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function waitForServer(url, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // server not ready
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server did not become ready: ${url}`);
}

async function newPage(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
  return { context, page };
}

async function selectElder(page) {
  await page.locator('button.role-option', { hasText: '我是老人' }).click();
  await page.waitForSelector('#elder-chat', { timeout: 5000 });
}

async function selectFamily(page) {
  await page.locator('button.role-option', { hasText: '我是家属' }).click();
  await page.waitForTimeout(250);
}

async function sendChat(page, text) {
  const before = await page.locator('#elder-chat .chat-row').count();
  await page.fill('#elder-chat input.chat-input', text);
  await page.locator('#elder-chat button', { hasText: '发送' }).click();
  await page
    .waitForFunction((expected) => document.querySelectorAll('#elder-chat .chat-row').length >= expected + 2, before, {
      timeout: 10000,
    })
    .catch(() => {});
  await page.waitForTimeout(250);
}

async function openProfile(page) {
  const summary = page.locator('details.advanced-details summary');
  if (await summary.isVisible({ timeout: 1000 }).catch(() => false)) {
    const opened = await page.locator('details.advanced-details').evaluate((element) => element.open);
    if (!opened) await summary.click();
    await page.waitForTimeout(250);
  }
}

async function timelineText(page) {
  return (await page.locator('.timeline li').allTextContents()).join('\n');
}

async function familyText(page) {
  return ((await page.locator('.family-dashboard').textContent().catch(() => '')) ?? '').trim();
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, name), fullPage: true });
}

async function caseThirdPerson(browser) {
  const { context, page } = await newPage(browser);
  try {
    await selectElder(page);
    await sendChat(page, '我觉得他喘得厉害');
    await openProfile(page);
    const timeline = await timelineText(page);
    const body = await page.locator('body').textContent();
    const passed = !timeline.includes('喘得厉害') && !((body ?? '').includes('当前状态：喘'));
    await screenshot(page, 'final-01-third-person.png');
    return { id: 'FINAL-01', result: passed ? 'PASS' : 'FAIL', timeline };
  } finally {
    await context.close();
  }
}

async function caseMixedSubjects(browser) {
  const { context, page } = await newPage(browser);
  try {
    await selectElder(page);
    await sendChat(page, '我爸今天没吃降压药，我也没吃');
    await openProfile(page);
    const timeline = await timelineText(page);
    const passed = timeline.includes('漏服') || timeline.includes('没吃');
    await screenshot(page, 'final-02-mixed-subjects.png');
    return { id: 'FINAL-02', result: passed ? 'PASS' : 'FAIL', timeline };
  } finally {
    await context.close();
  }
}

async function casePrivacyBoundary(browser) {
  const { context, page } = await newPage(browser);
  try {
    await selectElder(page);
    await sendChat(page, '上周摔了一下，先别告诉孩子们');
    const bodyBefore = await page.locator('body').textContent();
    await page.locator('button', { hasText: '切换身份' }).click();
    await selectFamily(page);
    const bodyAfter = await familyText(page);
    const passed = (bodyBefore ?? '').includes('摔') && !(bodyAfter.includes('上周摔了一下') || bodyAfter.includes('先别告诉'));
    await screenshot(page, 'final-03-privacy.png');
    return { id: 'FINAL-03', result: passed ? 'PASS' : 'FAIL', familyText: bodyAfter.slice(0, 400) };
  } finally {
    await context.close();
  }
}

async function caseRoleRefreshDoesNotRestore(browser) {
  const { context, page } = await newPage(browser);
  try {
    await selectElder(page);
    await sendChat(page, '这是刷新隔离探针-不要恢复');
    await page.reload({ waitUntil: 'networkidle' });
    const roleGateVisible = await page.locator('button.role-option', { hasText: '我是老人' }).isVisible({ timeout: 3000 }).catch(() => false);
    const body = (await page.locator('body').textContent()) ?? '';
    const passed = roleGateVisible && !body.includes('刷新隔离探针-不要恢复');
    await screenshot(page, 'final-04-refresh-isolation.png');
    return { id: 'FINAL-04', result: passed ? 'PASS' : 'FAIL', roleGateVisible };
  } finally {
    await context.close();
  }
}

async function caseTaskResidue(browser) {
  const { context, page } = await newPage(browser);
  try {
    await selectElder(page);
    await sendChat(page, '我今天摔了一下');
    await page.locator('button', { hasText: '切换身份' }).click();
    await selectFamily(page);
    const before = await familyText(page);
    await page.reload({ waitUntil: 'networkidle' });
    const roleGateVisible = await page.locator('button.role-option', { hasText: '我是老人' }).isVisible({ timeout: 3000 }).catch(() => false);
    const after = (await page.locator('body').textContent()) ?? '';
    const passed = roleGateVisible && !after.includes('摔了一下') && !after.includes('联系老人');
    await screenshot(page, 'final-05-task-residue.png');
    return { id: 'FINAL-05', result: passed ? 'PASS' : 'FAIL', before: before.slice(0, 250), roleGateVisible };
  } finally {
    await context.close();
  }
}

async function caseCorrection(browser) {
  const { context, page } = await newPage(browser);
  try {
    await selectElder(page);
    await sendChat(page, '我今天头晕');
    await sendChat(page, '我今天胸口有点闷');
    await sendChat(page, '说错了');
    await openProfile(page);
    const timeline = await timelineText(page);
    const passed = timeline.includes('头晕') && !timeline.includes('胸口有点闷');
    await screenshot(page, 'final-06-correction-lineage.png');
    return { id: 'FINAL-06', result: passed ? 'PASS' : 'FAIL', timeline };
  } finally {
    await context.close();
  }
}

async function caseComparative(browser) {
  const { context, page } = await newPage(browser);
  try {
    await selectElder(page);
    await sendChat(page, '今天没有像昨天那样喘得厉害了');
    await openProfile(page);
    const timeline = await timelineText(page);
    const passed = timeline.includes('今天') && timeline.includes('喘');
    await screenshot(page, 'final-07-comparative.png');
    return { id: 'FINAL-07', result: passed ? 'PASS' : 'FAIL', timeline };
  } finally {
    await context.close();
  }
}

async function caseOneTimeNoResurrection(browser) {
  const { context, page } = await newPage(browser);
  try {
    await selectElder(page);
    await sendChat(page, '我今天摔了一下，可以告诉孩子们');
    await page.locator('button', { hasText: '切换身份' }).click();
    await selectFamily(page);
    const first = await familyText(page);
    await page.reload({ waitUntil: 'networkidle' });
    const gateAfterReload = await page.locator('button.role-option', { hasText: '我是老人' }).isVisible({ timeout: 3000 }).catch(() => false);
    const second = (await page.locator('body').textContent()) ?? '';
    const passed = !gateAfterReload || true ? gateAfterReload && !second.includes('可以告诉孩子们') : false;
    await screenshot(page, 'final-08-one-time-reload.png');
    return { id: 'FINAL-08', result: passed ? 'PASS' : 'FAIL', first: first.slice(0, 300), gateAfterReload };
  } finally {
    await context.close();
  }
}

async function caseHistoricalIsolation(browser) {
  const { context, page } = await newPage(browser);
  try {
    await selectElder(page);
    await sendChat(page, '上周摔了一下，先别告诉孩子们');
    await sendChat(page, '我今天摔了一下，可以告诉孩子们');
    await openProfile(page);
    const body = (await page.locator('body').textContent()) ?? '';
    const passed = body.includes('摔') && !body.includes('无法共享') && !body.includes('已被历史私密记录阻断');
    await screenshot(page, 'final-09-historical-isolation.png');
    return { id: 'FINAL-09', result: passed ? 'PASS' : 'FAIL' };
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
  await waitForServer(BASE_URL);
  const browser = await chromium.launch({ headless: true });
  const cases = [
    caseThirdPerson,
    caseMixedSubjects,
    casePrivacyBoundary,
    caseRoleRefreshDoesNotRestore,
    caseTaskResidue,
    caseCorrection,
    caseComparative,
    caseOneTimeNoResurrection,
    caseHistoricalIsolation,
  ];
  const results = [];
  for (const test of cases) {
    try {
      const result = await test(browser);
      results.push(result);
      console.log(`${result.id}: ${result.result}`);
    } catch (error) {
      const id = `FINAL-${String(results.length + 1).padStart(2, '0')}`;
      const result = { id, result: 'BLOCKED', error: String(error).slice(0, 300) };
      results.push(result);
      console.log(`${id}: BLOCKED — ${result.error}`);
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(import.meta.dirname, 'final-blackbox-results.json'), JSON.stringify(results, null, 2));
  const allPass = results.length === cases.length && results.every((result) => result.result === 'PASS');
  console.log(`FINAL BLACKBOX: ${allPass ? 'ALL PASS' : 'NOT PASSING'}`);
  process.exitCode = allPass ? 0 : 1;
} finally {
  vite.kill('SIGTERM');
}
