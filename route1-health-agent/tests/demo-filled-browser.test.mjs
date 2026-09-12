import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { DEMO_PROFILE_SEED, PROFILE_STORAGE_KEY } from './helpers/demo-seed.mjs';

const browser = await chromium.launch({ headless: true });
try {
  for (const dataMode of ['demo', 'personal']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.addInitScript(({ key, profile }) => localStorage.setItem(key, JSON.stringify(profile)), {
      key: PROFILE_STORAGE_KEY,
      profile: { ...DEMO_PROFILE_SEED, dataMode, preferredRole: 'elder' },
    });
    await page.goto((process.env.TEST_BASE_URL || 'http://127.0.0.1:5173/'));
    const nav = page.getByRole('navigation', { name: '主要导航' });
    await nav.getByRole('button', { name: '健康档案' }).click();
    await page.waitForTimeout(250);
    const counts = await page.locator('.archive-category small').allTextContents();
    assert.deepEqual(counts, Array(6).fill(dataMode === 'demo' ? '2 份' : '0 份'));
    if (dataMode === 'demo') {
      await page.getByRole('button', { name: /年度健康体检摘要（上次记录）/ }).click();
      await page.locator('.archive-preview').waitFor();
      await page.waitForFunction(() => document.querySelector('.archive-preview')?.naturalWidth > 0);
      await page.screenshot({ path: '.test-build/demo-archive.png', fullPage: true });
      await nav.getByRole('button', { name: '药物', exact: true }).click();
      await page.getByRole('button', { name: /氨氯地平/ }).click();
      await page.getByText('1 片（5 mg）', { exact: true }).waitFor();
      await page.getByRole('button', { name: '返回药物' }).click();
      await page.getByRole('button', { name: '曾经使用', exact: true }).click();
      await page.getByRole('button', { name: /维生素 C/ }).waitFor();
      await nav.getByRole('button', { name: '首页', exact: true }).click();
      await page.getByRole('button', { name: /家庭空间/ }).click();
      assert.match(await page.getByRole('link', { name: '打开已准备好的示例房间' }).getAttribute('href'), /demo=1/);
    }
    await page.close();
  }
  console.log(
    'PASS old-demo enrichment, six filled categories, preview, medication detail/history, demo room entry, personal isolation',
  );
} finally {
  await browser.close();
}
