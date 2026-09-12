import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
let state = { homeId: 'a'.repeat(32), status: 'empty', message: '请拍摄房间', modelUrl: null };
let uploaded = false;
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/api/route2/homes**', (route) => {
  if (route.request().url().endsWith('/capture')) {
    uploaded = true;
    assert.match(route.request().headers()['content-type'], /multipart\/form-data/);
    state = { ...state, status: 'waiting_worker', message: '视频已保存，等待建模服务启用。' };
  }
  return route.fulfill({ json: state });
});
// Real MediaRecorder with a controlled canvas stream: tests recording lifecycle, not a physical camera.
await page.addInitScript(() => {
  navigator.mediaDevices.getUserMedia = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const context = canvas.getContext('2d');
    context.fillStyle = '#72baff';
    context.fillRect(0, 0, 320, 240);
    const stream = canvas.captureStream(10);
    window.testCaptureStream = stream;
    return stream;
  };
});
try {
  await page.goto('http://127.0.0.1:5174/');
  await page.getByRole('button', { name: '打开摄像头', exact: true }).click();
  await page.getByRole('button', { name: '开始拍摄', exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '继续拍摄', exact: true }).click();
  await page.getByRole('button', { name: '完成拍摄', exact: true }).click();
  await page.getByRole('button', { name: '上传并建立空间', exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => window.testCaptureStream.getTracks().every((t) => t.readyState === 'ended')),
    true,
  );
  await page.getByRole('button', { name: '上传并建立空间', exact: true }).click();
  await page.getByText('视频已保存，等待建模服务启用。', { exact: true }).waitFor();
  assert.equal(uploaded, true);
  assert.equal(await page.getByRole('button', { name: '查看我的家庭空间' }).isVisible(), false);
  await page.reload();
  await page.getByText('视频已保存，等待建模服务启用。', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '.test-build/home-capture.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS recording/pause/review/upload/track cleanup/reload persistence/mobile layout. GPU training not simulated as completion.',
  );
} finally {
  await browser.close();
}
