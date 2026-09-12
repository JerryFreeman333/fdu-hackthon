import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { DEMO_PROFILE_SEED, PROFILE_STORAGE_KEY } from './helpers/demo-seed.mjs';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.addInitScript(
  ({ key, profile }) => {
    localStorage.setItem(key, JSON.stringify({ ...profile, preferredRole: 'elder' }));
    window.SpeechRecognition = class {
      start() {
        window.testVoice = this;
        this.onstart?.();
      }
      stop() {
        this.onend?.();
      }
    };
  },
  { key: PROFILE_STORAGE_KEY, profile: DEMO_PROFILE_SEED },
);
try {
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: '开始说话', exact: true }).click();
  await page.getByRole('heading', { name: '正在听…' }).waitFor();
  const cancelBox = await page.getByRole('button', { name: '取消', exact: true }).boundingBox();
  assert.ok(cancelBox && cancelBox.y + cancelBox.height <= 844, '取消按钮应在手机首屏内');
  await page.screenshot({ path: '.test-build/voice-listening.png' });
  await page.evaluate(() => window.testVoice.onresult({ results: [[{ transcript: '这段应该取消' }]] }));
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.getByRole('button', { name: '开始说话', exact: true }).click();
  await page.evaluate(() => {
    window.testVoice.onresult({ results: [[{ transcript: '你好，陪我聊聊天' }]] });
    window.testVoice.onend();
  });
  await page.locator('.assistant-is-open').waitFor();
  assert.equal(await page.getByText('你好，陪我聊聊天', { exact: true }).count(), 1);
  assert.equal(await page.getByText('这段应该取消', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '开始说话', exact: true }).click();
  await page.evaluate(() => window.testVoice.onerror({ error: 'not-allowed' }));
  await page.getByRole('heading', { name: '暂时没能听到您' }).waitFor();
  assert.equal(await page.locator('.voice-phase-listening').count(), 0);
  await page.getByRole('button', { name: '返回输入文字', exact: true }).click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  console.log(
    'PASS shared listening UI, cancellation discards transcript, completion sends once, permission failure stops listening display',
  );
} finally {
  await browser.close();
}
