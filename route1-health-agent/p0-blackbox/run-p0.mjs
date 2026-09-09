import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:5173';
const SCREENSHOT_DIR = path.join(import.meta.dirname, 'screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// ── helpers ──
async function newCtx(browser) {
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
  await page.waitForTimeout(400);
}

async function sendChat(page, text) {
  const before = await page.locator('#elder-chat .chat-row').count();
  await page.fill('#elder-chat input.chat-input', text);
  await page.locator('#elder-chat button', { hasText: '发送' }).click();
  await page.waitForFunction(
    (p) => document.querySelectorAll('#elder-chat .chat-row').length >= p + 2,
    before,
    { timeout: 10000 },
  ).catch(() => {});
  await page.waitForTimeout(300);
}

async function lastAgentReply(page) {
  const reps = await page.locator('#elder-chat .row-agent .chat-bubble p').allTextContents();
  return reps.at(-1) ?? '';
}

async function allAgentReplies(page) {
  return page.locator('#elder-chat .row-agent .chat-bubble p').allTextContents();
}

async function openProfile(page) {
  const s = page.locator('details.advanced-details summary');
  if (await s.isVisible({ timeout: 2000 }).catch(() => false)) {
    const open = await page.locator('details.advanced-details').evaluate((el) => el.open);
    if (!open) { await s.click(); await page.waitForTimeout(400); }
  }
}

async function getFindings(page) {
  const card = page.locator('.highlight-card');
  if (!(await card.isVisible({ timeout: 1000 }).catch(() => false))) return [];
  const items = card.locator('.finding');
  const n = await items.count();
  const out = [];
  for (let i = 0; i < n; i++) {
    const title = (await items.nth(i).locator('.finding-head b').textContent().catch(() => '')) ?? '';
    const detail = (await items.nth(i).locator('p').textContent().catch(() => '')) ?? '';
    out.push({ title: title.trim(), detail: detail.trim() });
  }
  return out;
}

async function getObservations(page) {
  const items = page.locator('.timeline li');
  const n = await items.count();
  const out = [];
  for (let i = 0; i < n; i++) {
    const text = (await items.nth(i).locator('.tl-text').textContent().catch(() => '')) ?? '';
    out.push(text.trim());
  }
  return out;
}

async function switchRole(page) {
  await page.locator('button', { hasText: '切换身份' }).first().click();
  await page.waitForTimeout(400);
}

async function generateInvite(page) {
  await page.locator('button', { hasText: '生成家属邀请码' }).click();
  await page.waitForTimeout(400);
  const txt = (await page.locator('.privacy-card').last().textContent()) ?? '';
  const m = txt.match(/AN-\d{4}-\d{4}/);
  return m ? m[0] : '';
}

async function bindFamily(page, code) {
  await page.locator('input.chat-input').fill(code);
  await page.locator('button', { hasText: '绑定' }).click();
  await page.waitForTimeout(800);
}

async function ensureGranted(page) {
  const btn = page.locator('button', { hasText: '同意以后需要时告诉家属' });
  if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(400);
    return true;
  }
  await page.evaluate(() => {
    localStorage.setItem('ankang-route1-consent-v2', JSON.stringify({ familySharing: 'granted', updatedAt: new Date().toISOString() }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('button.role-option', { hasText: '我是老人' }).click();
  await page.waitForSelector('#elder-chat', { timeout: 5000 });
  return false;
}

async function revokeSharing(page) {
  const btn = page.locator('button', { hasText: '暂停家属共享' });
  if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(400);
  }
}

async function familyBodyText(page) {
  return ((await page.locator('.family-dashboard').textContent().catch(() => '')) ?? '').trim();
}

function hasFallFinding(findings) {
  return findings.some((f) => f.title.includes('跌倒') || f.title.includes('摔') || f.detail.includes('跌倒') || f.detail.includes('摔'));
}

// ── P0-01 ──
async function p0_01(browser) {
  const { context, page } = await newCtx(browser);
  try {
    await selectElder(page);
    await sendChat(page, '我觉得他喘得厉害');
    const reply = await lastAgentReply(page);
    await openProfile(page);
    const findings = await getFindings(page);
    const obs = await getObservations(page);
    const replyClarifies = /确认|家里|自己|他|她|不确定|澄清/.test(reply);
    const obsHasNewDyspnea = obs.some((o) => o.includes('喘得厉害'));
    const findingsHasDyspnea = findings.some((f) => f.title.includes('喘') || f.detail.includes('喘'));
    const pass = replyClarifies && !obsHasNewDyspnea && !findingsHasDyspnea;
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'p0-01.png'), fullPage: true });
    return { id: 'P0-01', result: pass ? 'PASS' : 'FAIL', reply, findings, obs };
  } finally { await context.close(); }
}

// ── P0-02 ──
async function p0_02(browser) {
  const { context, page } = await newCtx(browser);
  try {
    await selectElder(page);
    await sendChat(page, '我爸今天没吃降压药，我也没吃');
    const reply = await lastAgentReply(page);
    await openProfile(page);
    const obs = await getObservations(page);
    const replyHasBoth = reply.includes('爸') && (reply.includes('我') || reply.includes('本人') || reply.includes('漏服'));
    const obsHasSelfMed = obs.some((o) => o.includes('我也没吃') || o.includes('没吃'));
    const pass = replyHasBoth && obsHasSelfMed;
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'p0-02.png'), fullPage: true });
    return { id: 'P0-02', result: pass ? 'PASS' : 'FAIL', reply, obs };
  } finally { await context.close(); }
}

// ── P0-03 ──
async function p0_03(browser) {
  const { context, page } = await newCtx(browser);
  try {
    await selectElder(page);
    await sendChat(page, '上周摔了一下，先别告诉孩子们');
    await sendChat(page, '我今天摔了一下，可以告诉孩子们');
    await openProfile(page);
    const findings = await getFindings(page);
    const pass = hasFallFinding(findings);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'p0-03.png'), fullPage: true });
    return { id: 'P0-03', result: pass ? 'PASS' : 'FAIL', findings };
  } finally { await context.close(); }
}

// ── P0-04 ──
async function p0_04(browser) {
  const { context, page } = await newCtx(browser);
  try {
    await selectElder(page);
    const code = await generateInvite(page);
    await sendChat(page, '上周摔了一下，先别告诉孩子们');
    await openProfile(page);
    const obs = await getObservations(page);
    const elderHasFall = obs.some((o) => o.includes('摔'));
    await switchRole(page);
    await selectFamily(page);
    await bindFamily(page, code);
    const familyText = await familyBodyText(page);
    const familyLeaked = familyText.includes('上周摔了一下') || familyText.includes('先别告诉');
    const pass = elderHasFall && !familyLeaked;
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'p0-04.png'), fullPage: true });
    return { id: 'P0-04', result: pass ? 'PASS' : 'FAIL', elderHasFall, familyLeaked, familyText: familyText.slice(0, 500) };
  } finally { await context.close(); }
}

// ── P0-05 ──
async function p0_05(browser) {
  const { context, page } = await newCtx(browser);
  try {
    await selectElder(page);
    await ensureGranted(page);
    await sendChat(page, '我今天摔了一下');
    const code = await generateInvite(page);
    await switchRole(page);
    await selectFamily(page);
    await bindFamily(page, code);
    const beforeText = await familyBodyText(page);
    const beforeHasNotif = !beforeText.includes('目前没有新的家属通知');
    await switchRole(page);
    await selectElder(page);
    await revokeSharing(page);
    await switchRole(page);
    await selectFamily(page);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const afterText = await familyBodyText(page);
    const afterHasNotif = !afterText.includes('目前没有新的家属通知');
    const pass = beforeHasNotif && !afterHasNotif;
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'p0-05.png'), fullPage: true });
    return { id: 'P0-05', result: pass ? 'PASS' : 'FAIL', beforeHasNotif, afterHasNotif, beforeText: beforeText.slice(0, 300), afterText: afterText.slice(0, 300) };
  } finally { await context.close(); }
}

// ── P0-06 ──
async function p0_06(browser) {
  const { context, page } = await newCtx(browser);
  try {
    await selectElder(page);
    const code = await generateInvite(page);
    await sendChat(page, '上周摔了一下，先别告诉孩子们');
    await switchRole(page);
    await selectFamily(page);
    await bindFamily(page, code);
    const familyText = await familyBodyText(page);
    const leaked = familyText.includes('上周摔了一下') || familyText.includes('先别告诉');
    const pass = !leaked;
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'p0-06.png'), fullPage: true });
    return { id: 'P0-06', result: pass ? 'PASS' : 'FAIL', leaked, familyText: familyText.slice(0, 500) };
  } finally { await context.close(); }
}

// ── P0-07 ──
async function p0_07(browser) {
  const { context, page } = await newCtx(browser);
  try {
    await selectElder(page);
    await sendChat(page, '我今天头晕');
    await sendChat(page, '我今天胸口有点闷');
    await sendChat(page, '说错了');
    await openProfile(page);
    const obs = await getObservations(page);
    const hasA = obs.some((o) => o.includes('头晕'));
    const hasB = obs.some((o) => o.includes('胸口'));
    const pass = hasA && !hasB;
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'p0-07.png'), fullPage: true });
    return { id: 'P0-07', result: pass ? 'PASS' : 'FAIL', hasA, hasB, obs };
  } finally { await context.close(); }
}

// ── P0-08 ──
async function p0_08(browser) {
  const { context, page } = await newCtx(browser);
  try {
    await selectElder(page);
    await sendChat(page, '我今天摔了一下');
    await openProfile(page);
    const findingsBefore = await getFindings(page);
    const hadFall = hasFallFinding(findingsBefore);
    await sendChat(page, '说错了');
    await openProfile(page);
    const findingsAfter = await getFindings(page);
    const stillHasFall = hasFallFinding(findingsAfter);
    const pass = hadFall && !stillHasFall;
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'p0-08.png'), fullPage: true });
    return { id: 'P0-08', result: pass ? 'PASS' : 'FAIL', hadFall, stillHasFall, findingsBefore, findingsAfter };
  } finally { await context.close(); }
}

// ── start vite dev server inside the script ──
import { spawn } from 'child_process';
const viteDir = path.resolve(import.meta.dirname, '..');
const vite = spawn('node', ['node_modules/vite/bin/vite.js', '--port', '5173', '--strictPort'], {
  cwd: viteDir,
  stdio: ['ignore', 'pipe', 'pipe'],
});
vite.stdout.on('data', (d) => process.stderr.write(`[vite] ${d}`));
vite.stderr.on('data', (d) => process.stderr.write(`[vite-err] ${d}`));

async function waitForServer(url, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('vite did not start within timeout');
}
await waitForServer(BASE_URL);
console.log('vite dev server ready');

// ── main ──
const browser = await chromium.launch({ headless: true });
const results = [];
for (const fn of [p0_01, p0_02, p0_03, p0_04, p0_05, p0_06, p0_07, p0_08]) {
  try {
    const r = await fn(browser);
    results.push(r);
    console.log(`${r.id}: ${r.result}`);
  } catch (e) {
    const id = `P0-0${results.length + 1}`;
    results.push({ id, result: 'BLOCKED', error: String(e).slice(0, 200) });
    console.log(`${id}: BLOCKED — ${String(e).slice(0, 120)}`);
  }
}
await browser.close();
vite.kill('SIGTERM');

fs.writeFileSync(path.join(import.meta.dirname, 'p0-results.json'), JSON.stringify(results, null, 2));
console.log('\n=== P0 SUMMARY ===');
for (const r of results) console.log(`${r.id}: ${r.result}`);
const allPass = results.every((r) => r.result === 'PASS');
console.log(`\nMerge Gate: ${allPass ? 'ALL PASS — PR #25 may merge' : 'BLOCKED — at least one P0 failed'}`);