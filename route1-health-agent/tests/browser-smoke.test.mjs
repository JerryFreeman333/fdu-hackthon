import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const PORT = Number(process.env.BROWSER_SMOKE_PORT ?? 4173);

let serverProcess = null;

const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  log(`${ok ? '\u2713' : '\u2717'} ${name}${detail ? ' \u2014 ' + detail : ''}`);
}

function log(...args) {
  console.log('[browser-smoke]', ...args);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit' });
    p.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} \u9000\u51fa\u7801 ${code}`)),
    );
    p.on('error', reject);
  });
}

async function ensureBuild() {
  if (!existsSync(DIST) || !existsSync(resolve(DIST, 'index.html'))) {
    log('dist/ \u4e0d\u5b58\u5728\uff0c\u5148 build');
    await run('npm', ['run', 'build']);
  } else {
    log('dist/ \u5df2\u5b58\u5728');
  }
}

function startPreview() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const onData = (chunk) => {
      const text = chunk.toString();
      process.stdout.write('[preview] ' + text);
      if (text.includes('Local:') || text.includes('localhost')) resolve();
    };
    serverProcess.stdout.on('data', onData);
    serverProcess.stderr.on('data', onData);
    serverProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) reject(new Error(`vite preview \u9000\u51fa\u7801 ${code}`));
    });
    setTimeout(() => reject(new Error('vite preview \u542f\u52a8\u8d85\u65f6')), 30000);
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
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) return;
    } catch {}
    await wait(250);
  }
  throw new Error('preview server \u672a\u5c31\u7ee7');
}

async function runSmoke(browser) {
  const context = await browser.newContext({ locale: 'zh-CN' });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') log('console.error:', msg.text());
  });
  page.on('pageerror', (err) => log('pageerror:', err.message));

  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    const title = await page.title();
    check('\u5e94\u7528\u52a0\u8f7d', !!title, `title=${title}`);

    // 1. RoleGate \u4e0a\u540c\u65f6\u6709\u8001\u4eba/\u5bb6\u5c5e
    const roleGateVisible = await page
      .getByText(/\u6709\u4e8b\u60c5|\u5b89\u5b89|\u5bb6\u5c5e\u52a9\u624b|\u8001\u4eba\u52a9\u624b/)
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    check('\u89d2\u8272\u9009\u62e9\u53ef\u89c1', roleGateVisible);

    const elderOption = await page
      .getByRole('button', { name: /\u6211\u662f\u8001\u4eba/ })
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    const familyOption = await page
      .getByRole('button', { name: /\u6211\u662f\u5bb6\u5c5e/ })
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    check(
      '\u89d2\u8272\u9009\u62e9\u540c\u65f6\u63d0\u4f9b\u8001\u4eba/\u5bb6\u5c5e',
      elderOption && familyOption,
      `\u8001\u4eba=${elderOption}, \u5bb6\u5c5e=${familyOption}`,
    );

    // 2. \u9009\u8001\u4eba\u8fdb\u5165\u4e3b\u754c\u9762
    if (roleGateVisible) {
      await page
        .getByRole('button', { name: /\u6211\u662f\u8001\u4eba/ })
        .click({ timeout: 3000 })
        .catch(() => {});
      await wait(1000);
    }

    // 3. \u8f93\u5165\u6846\u53ef\u7528
    const input = page.getByPlaceholder(/\u50cf\u5e73\u65f6\u804a\u5929\u4e00\u6837|\u8bf4\u8bf4\u4eca\u5929/).first();
    const inputExists = await input.isVisible({ timeout: 5000 }).catch(() => false);
    check('\u804a\u5929\u8f93\u5165\u53ef\u7528', inputExists);
    if (!inputExists) throw new Error('\u672a\u627e\u5230\u8f93\u5165\u6846');

    // 4. \u8f93\u5165\u4f4e\u8840\u6c27\uff0c\u9a8c\u8bc1\u5b89\u5168\u63d0\u793a
    await input.fill('\u6211\u8840\u6c27 85');
    const sendBtn = page
      .locator('button')
      .filter({ hasText: /\u53d1\u9001|\u63d0\u4ea4/ })
      .first();
    const sendBtnExists = await sendBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (sendBtnExists) await sendBtn.click();
    else await input.press('Enter');
    await page.waitForTimeout(2000);

    const bodyText = await page.locator('body').innerText();
    const hasReassuring =
      bodyText.includes('\u590d\u6d4b') ||
      bodyText.includes('\u8c03\u4f53') ||
      bodyText.includes('\u5b89\u5168') ||
      bodyText.includes('\u8bbe\u5907');
    check('\u4f4e\u8840\u6c27\u63d0\u793a\u51fa\u73b0', hasReassuring);
    const hasSafetyTitle = bodyText.includes('\u8840\u6c27') || /\b85\b/.test(bodyText);
    check('\u4f4e\u8840\u6c27\u5b89\u5168\u63d0\u793a', hasSafetyTitle);

    // 5. \u5feb\u6377\u8f93\u5165\u6309\u94ae: \u70b9 \u201c\u8fd1\u8eab\u8def\u4e0d\u8212\u670d\u201d\u7b49
    const quickBtn = page
      .getByRole('button', {
        name: /\u8fd1\u8eab\u8def|\u521a\u624d\u8df3\u4e86|\u8fd9\u4e24\u5929\u7761\u4e0d\u597d|\u6700\u8fd1\u8db3|\u836f\u5fd8\u8bb0\u5403|\u521a\u624d|\u8eab\u4f53|\u4e0d|\u7761|\u836f/,
      })
      .first();
    const quickExists = await quickBtn.isVisible({ timeout: 2000 }).catch(() => false);
    check('\u5feb\u6377\u8f93\u5165\u53ef\u70b9', quickExists);
    if (quickExists) {
      await quickBtn.click();
      await wait(2000);
    }

    // 6. \u8df3\u8f6c\u89d2\u8272: \u70b9 \u201c\u5207\u6362\u8eab\u4efd\u201d
    const switchBtn = page.locator('text=\u5207\u6362\u8eab\u4efd').first();
    const switchVisible = await switchBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (switchVisible) {
      await switchBtn.click({ force: true });
      await wait(1500);
      const elderAgain = await page
        .getByRole('button', { name: /\u6211\u662f\u8001\u4eba/ })
        .isVisible({ timeout: 2000 })
        .catch(() => false);
      check('\u5207\u6362\u8eab\u4efd\u53ef\u91cd\u8fd4 RoleGate', elderAgain);
    } else {
      check(
        '\u5207\u6362\u8eab\u4efd\u53ef\u91cd\u8fd4 RoleGate',
        false,
        '\u672a\u627e\u5230\u5207\u6362\u8eab\u4efd\u6309\u94ae',
      );
    }
  } finally {
    await page.screenshot({ path: resolve(ROOT, 'tests', 'browser-smoke.png'), fullPage: true }).catch(() => {});
    await context.close();
  }
}

// 用药与医护（子女端新模块）：授权 → 可见药品/今日状态/医护入口；撤销授权 → fail-closed。
async function runFamilyMedicationScenario(browser) {
  log('开始 用药与医护 家属端场景');
  const context = await browser.newContext({ locale: 'zh-CN' });
  const page = await context.newPage();
  const text = () => page.locator('body').innerText();
  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });

    // 老人端：报告跌倒触发家属协同卡片，并授权持久共享
    await page.getByRole('button', { name: /我是老人/ }).click();
    await page.waitForTimeout(1000);
    const chatInput = page.locator('#elder-chat input.chat-input');
    await chatInput.waitFor({ timeout: 5000 });
    await chatInput.fill('我刚刚摔倒了');
    await page.locator('#elder-chat button', { hasText: '发送' }).click();

    const shareBtn = page.locator('button', { hasText: '同意以后需要时告诉家属' });
    await shareBtn.waitFor({ timeout: 8000 });
    check('老人端出现家属授权卡片', await shareBtn.isVisible());
    await shareBtn.click();
    await page.waitForTimeout(500);

    await page.locator('button', { hasText: '生成家属邀请码' }).click();
    await page.waitForTimeout(500);
    const match = (await text()).match(/AN-\d{4}-\d{4}/);
    check('老人端生成邀请码', !!match);
    if (!match) return;

    // 切到家属端并绑定
    await page.locator('button', { hasText: '切换身份' }).click();
    await page.getByRole('button', { name: /我是家属/ }).click();
    const inviteInput = page.locator('.family-dashboard input.chat-input');
    await inviteInput.waitFor({ timeout: 5000 });
    await inviteInput.fill(match[0]);
    await page.locator('.family-dashboard button', { hasText: '绑定' }).click();
    await page.waitForTimeout(800);

    // 进入"用药与医护"
    const medTab = page.locator('.family-secondary-nav button', { hasText: '用药与医护' });
    check('家属端出现用药与医护入口', await medTab.isVisible({ timeout: 5000 }).catch(() => false));
    if (!(await medTab.isVisible().catch(() => false))) return;
    await medTab.click();
    await page.waitForTimeout(500);
    const medText = await text();
    check('已授权家属可见药品档案', medText.includes('氨氯地平') && medText.includes('美托洛尔'));
    check('pending 显示为待确认', medText.includes('待确认'));
    check('未确认时提示联系老人', medText.includes('今天的服药还没有确认'));
    check('已配置时显示联系社区医生入口', medText.includes('联系社区医生'));

    // 撤销授权后必须 fail-closed
    await page.locator('button', { hasText: '← 返回' }).click();
    await page.waitForTimeout(300);
    await page.locator('button', { hasText: '切换身份' }).click();
    await page.getByRole('button', { name: /我是老人/ }).click();
    const revokeBtn = page.locator('button', { hasText: '暂停家属共享' });
    await revokeBtn.waitFor({ timeout: 5000 });
    check('老人端可暂停家属共享', await revokeBtn.isVisible());
    await revokeBtn.click();
    await page.waitForTimeout(500);
    await page.locator('button', { hasText: '切换身份' }).click();
    await page.getByRole('button', { name: /我是家属/ }).click();
    await page.waitForTimeout(800);
    await page.locator('.family-secondary-nav button', { hasText: '用药与医护' }).click();
    await page.waitForTimeout(500);
    const revokedText = await text();
    check(
      '未授权时用药页 fail-closed',
      revokedText.includes('老人尚未授权家属查看详细用药信息') && !revokedText.includes('氨氯地平'),
    );
  } finally {
    await page.screenshot({ path: resolve(ROOT, 'tests', 'family-medication.png'), fullPage: true }).catch(() => {});
    await context.close();
  }
}

async function main() {
  await ensureBuild();
  const browser = await chromium.launch({ headless: true });
  try {
    await startPreview();
    await fetchReady();
    log(`preview \u670d\u52a1\u5df2\u5c31\u7ee7 (http://localhost:${PORT})`);
    await runSmoke(browser);
    await runFamilyMedicationScenario(browser);
  } finally {
    await browser.close().catch(() => {});
    stopPreview();
    await wait(200);
  }
  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  log(`\u603b\u8ba1: ${passed}/${total} \u901a\u8fc7`);
  if (passed < total) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[browser-smoke] \u9519\u8bef:', err);
  process.exit(1);
});
