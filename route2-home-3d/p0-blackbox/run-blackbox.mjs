import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(process.cwd(), '..');
const webDir = path.join(root, 'web');
const baseURL = 'http://127.0.0.1:4173';
const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function check(name, fn, timeoutMs = 8000) {
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`case timeout after ${timeoutMs}ms`)), timeoutMs)),
    ]);
    record(name, true);
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForServer(url, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Vite did not become ready at ${url}`);
}

const vite = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
  cwd: webDir,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env },
});
vite.stdout.on('data', (chunk) => process.stdout.write(`[vite] ${chunk}`));
vite.stderr.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`));

let browser;
let tempDir;
try {
  await waitForServer(baseURL);
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-webgl'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  page.setDefaultNavigationTimeout(8000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await check('01 首页能完整启动，不出现初始化失败', async () => {
    const response = await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    expect(response?.ok(), `HTTP ${response?.status()}`);
    await page.locator('#scene-badge').waitFor({ state: 'visible' });
    await page.waitForTimeout(500);
    const hint = (await page.locator('#hint').textContent()) ?? '';
    expect(!hint.includes('初始化失败'), hint || '初始化失败');
  });

  await check('02 无真实 home.ply 时明确标注为合成演示，不冒充真实模型', async () => {
    const badge = (await page.locator('#scene-badge').textContent())?.trim() ?? '';
    expect(badge.includes('合成演示场景') && badge.includes('预置数据'), `实际 badge: ${badge}`);
  });

  await check('03 默认老人视角只暴露日常功能，家属风险页不抢占首页', async () => {
    expect(await page.getByRole('button', { name: '我是老人', exact: true }).getAttribute('aria-pressed') === 'true', '默认角色不是老人');
    expect(await page.getByRole('button', { name: '我的家', exact: true }).isVisible(), '“我的家”不可见');
    expect(await page.getByRole('button', { name: '找东西', exact: true }).isVisible(), '“找东西”不可见');
    expect(!(await page.getByRole('button', { name: '风险证据', exact: true }).isVisible()), '老人端暴露了风险证据标签');
  });

  await check('04 老人“找老花镜”路径能完成并给出人话位置', async () => {
    await page.getByRole('button', { name: '找东西', exact: true }).click();
    await page.getByRole('button', { name: /老花镜/ }).click();
    const hint = (await page.locator('#hint').textContent()) ?? '';
    expect(hint.includes('找到「老花镜」'), `提示缺少找到结果: ${hint}`);
    expect(hint.includes('卧室床头柜上'), `提示缺少位置: ${hint}`);
  });

  await check('05 切到家属端后能看到待处理行动，而不是只有风险分数', async () => {
    await page.getByRole('button', { name: '我是子女/照护者', exact: true }).click();
    expect(await page.getByRole('button', { name: '家庭状态', exact: true }).isVisible(), '家庭状态不可见');
    const panel = await page.locator('#panel').innerText();
    expect(panel.includes('处理地面障碍'), '缺少处理地面障碍行动');
    expect(panel.includes('复核夜间通行路线'), '缺少夜间路线行动');
    expect(panel.includes('重新扫描'), '缺少复扫闭环提示');
  });

  await check('06 家属可打开具体风险证据，看到位置/风险/建议三件事', async () => {
    await page.getByRole('button', { name: '风险证据', exact: true }).click();
    await page.getByRole('button', { name: /地毯翘边/ }).click();
    const card = await page.locator('#hazard-card').innerText();
    expect(card.includes('地毯翘边'), '风险标题缺失');
    expect(card.includes('卧室通往走廊的地毯一角'), '位置证据缺失');
    expect(card.includes('夜间起夜'), '风险解释缺失');
    expect(card.includes('固定'), '整改建议缺失');
  });

  await check('07 路线展示明确是风险影响解释，不宣称“安全保证”', async () => {
    await page.getByRole('button', { name: '影响路线', exact: true }).click();
    await page.getByRole('button', { name: /夜间起夜动线/ }).click();
    const hint = (await page.locator('#hint').textContent()) ?? '';
    expect(hint.includes('夜间起夜动线'), `路线提示缺失: ${hint}`);
    expect(hint.includes('影响风险'), `风险影响缺失: ${hint}`);
    const body = await page.locator('body').innerText();
    expect(body.includes('不代表 AI 已预测老人实际会怎么走'), '缺少路线能力边界说明');
  });

  await check('08 复扫服务不可用时 fail-closed：不把旧风险误标为已解决', async () => {
    await page.getByRole('button', { name: '家庭状态', exact: true }).click();
    tempDir = await mkdtemp(path.join(tmpdir(), 'route2-blackbox-'));
    const pngPath = path.join(tempDir, 'rescan.png');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zr5kAAAAASUVORK5CYII=', 'base64');
    await writeFile(pngPath, png);
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 4000 });
    await page.getByRole('button', { name: /重新扫描确认/ }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(pngPath);
    await page.waitForFunction(() => document.querySelector('#hint')?.textContent?.includes('本次复扫未改变现有风险/行动状态'), null, { timeout: 6000 });
    const panel = await page.locator('#panel').innerText();
    expect(panel.includes('待处理'), '复扫失败后行动被错误关闭');
    expect(!panel.includes('环境风险已关闭'), '复扫失败后错误显示环境风险已关闭');
  }, 10000);

  await check('09 身份偏好刷新后仍保留家属视角', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#role-switcher').waitFor({ state: 'visible' });
    expect(await page.getByRole('button', { name: '我是子女/照护者', exact: true }).getAttribute('aria-pressed') === 'true', '刷新后角色没有保留');
    expect(await page.getByRole('button', { name: '家庭状态', exact: true }).isVisible(), '刷新后没有回到家属功能');
  });

  await check('10 整个用户旅程无未捕获页面异常', async () => {
    expect(pageErrors.length === 0, pageErrors.join(' | '));
  });

  const failed = results.filter((item) => !item.ok);
  console.log(`\nBLACKBOX SUMMARY: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  vite.kill('SIGKILL');
}
