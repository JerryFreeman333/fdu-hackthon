import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Adapted from route2/blackbox-audit-20260911. One locked dependency set,
// cross-platform child process, isolated port/browser, no real upload or account.
const webDir = fileURLToPath(new URL('../web/', import.meta.url));
const require = createRequire(path.join(webDir, 'package.json'));
const { chromium } = require('playwright');
const port = process.env.ROUTE2_TEST_PORT || '4187';
const origin = 'http://127.0.0.1:' + port;
const vite = spawn(process.execPath, [path.join(webDir, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', port, '--strictPort'], {
  cwd: webDir, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let startupError;
vite.on('error', error => { startupError = error; });
let logs = '';
vite.stderr.on('data', data => { logs += data; });
vite.stdout.on('data', data => { logs += data; });
let browser;
let count = 0;
async function check(name, run) {
  await run();
  count++;
  console.log('PASS ' + name);
}
try {
  for (let attempt = 0; ; attempt++) {
    if (startupError) throw startupError;
    if (vite.exitCode !== null) throw new Error('Vite exited: ' + logs);
    try {
      const response = await fetch(origin + '/index.html', { signal: AbortSignal.timeout(2000) });
      if (response.ok) break;
      if (attempt === 5) console.error('Readiness HTTP', response.status, await response.text());
    } catch (error) { if (attempt === 5) console.error('Readiness fetch', error); }
    if (attempt >= 60) throw new Error('Vite startup timeout: ' + logs);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // No test can accidentally upload room media to the user's running backend.
  await context.route('**/api/**', route => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'isolated-test-offline' }),
  }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(8000);
  page.setDefaultNavigationTimeout(15000);
  await check('首次真实入口显示拍摄引导，不偷偷加载示例', async () => {
    await page.goto(origin);
    await page.getByRole('heading', { name: '建立我的家庭空间' }).waitFor();
    await page.getByRole('button', { name: '打开摄像头', exact: true }).waitFor();
    assert.equal(await page.locator('#scene-badge').count(), 0);
  });
  await check('显式进入示例，清楚标注合成演示和预置数据', async () => {
    await page.getByRole('link', { name: '查看示例空间' }).click();
    await page.waitForFunction(() => document.querySelector('#scene-badge')?.textContent?.includes('合成演示场景'));
    assert.match(await page.locator('#scene-badge').innerText(), /合成演示场景.*预置数据/);
  });
  await check('老人视角能找眼镜，风险功能不会抢占日常入口', async () => {
    assert.equal(await page.getByRole('button', { name: '我是老人', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: '找东西', exact: true }).click();
    await page.getByRole('button', { name: /老花镜/ }).click();
    assert.match(await page.locator('#hint').innerText(), /找到「老花镜」.*卧室床头柜上/);
  });
  await check('家属查看具体行动及风险证据', async () => {
    await page.getByRole('button', { name: '我是子女/照护者', exact: true }).click();
    assert.match(await page.locator('#panel').innerText(), /处理地面障碍/);
    await page.getByRole('button', { name: '风险证据', exact: true }).click();
    await page.getByRole('button', { name: /地毯翘边/ }).click();
    assert.match(await page.locator('#hazard-card').innerText(), /固定/);
  });
  await check('影响路线只解释风险，不宣称现场安全', async () => {
    await page.getByRole('button', { name: '影响路线', exact: true }).click();
    await page.getByRole('button', { name: /夜间起夜动线/ }).click();
    assert.match(await page.locator('#hint').innerText(), /影响风险/);
    assert.match(await page.locator('body').innerText(), /不代表 AI 已预测老人实际会怎么走/);
  });
  await check('复扫后端离线时不弹上传框、不关闭风险', async () => {
    await page.getByRole('button', { name: '家庭状态', exact: true }).click();
    let chooserOpened = false;
    page.once('filechooser', () => { chooserOpened = true; });
    await page.getByRole('button', { name: /重新扫描确认/ }).click();
    await page.waitForFunction(() => document.querySelector('#hint')?.textContent?.includes('本次未选择文件'));
    assert.equal(chooserOpened, false);
    assert.match(await page.locator('#panel').innerText(), /待处理/);
    assert.doesNotMatch(await page.locator('#panel').innerText(), /环境风险已关闭/);
  });
  await check('刷新保留家属偏好；老人找药深链可以覆盖旧偏好', async () => {
    await page.reload();
    assert.equal(await page.getByRole('button', { name: '我是子女/照护者', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.goto(origin + '/?demo=1&role=resident&find=medicine');
    await page.waitForFunction(() => document.querySelector('#hint')?.textContent?.includes('找到'));
    assert.match(await page.locator('#hint').innerText(), /降压药/);
  });
  await check('完整旅程无未捕获 JS 错误', async () => assert.deepEqual(errors, []));
  console.log('BLACKBOX SUMMARY: ' + count + '/' + count + ' passed');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (vite.exitCode === null) {
    const stopped = once(vite, 'exit');
    vite.kill();
    await stopped;
  }
}
