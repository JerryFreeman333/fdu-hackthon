import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  // Controlled recognition double tests UI lifecycle, not real microphone/cloud availability.
  await page.addInitScript(() => {
    window.SpeechRecognition = class {
      start() {
        window.testRecognition = this;
      }
      stop() {
        this.onend?.();
      }
    };
  });
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173');
  await page.getByRole('button', { name: /我是老人/ }).click();
  await page.getByRole('button', { name: /创建真实档案/ }).click();
  await page.getByRole('button', { name: '微信授权登录' }).click();
  await page.getByRole('status').filter({ hasText: '尚未配置' }).waitFor();
  await page.getByRole('button', { name: '暂不登录，先创建本机档案' }).click();
  await page.locator('#profile-name').fill('测试用户');
  await page.locator('#profile-age').fill('68');
  await page.locator('#profile-sex').selectOption('female');
  await page.locator('#profile-conditions').fill('高血压');
  await page.getByRole('button', { name: '好了，开始使用' }).click();
  const nav = page.getByRole('navigation', { name: '主要导航' });
  assert.deepEqual(await nav.getByRole('button').allTextContents(), ['首页', '药物', '健康档案', '我的']);
  await nav.getByRole('button', { name: '药物', exact: true }).click();
  await page.getByRole('button', { name: '＋ 添加药物' }).click();
  await page.getByLabel('药物名称').fill('测试药物');
  await page.getByLabel('每次剂量').fill('1 片');
  await page.getByLabel('服用时间').fill('08:00');
  await page.getByLabel('用途 / 医嘱说明').fill('依照医生填写的说明');
  await page.getByRole('button', { name: '保存药物', exact: true }).click();
  await page.getByRole('heading', { name: '测试药物', exact: true }).waitFor();
  await page.reload();
  await nav.getByRole('button', { name: '药物', exact: true }).click();
  await page.getByRole('button', { name: /测试药物/ }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('使用状态').selectOption('stopped');
  await page.getByRole('button', { name: '保存药物', exact: true }).click();
  await page.getByRole('button', { name: '返回药物' }).click();
  assert.equal(await page.getByRole('button', { name: /测试药物/ }).count(), 0);
  await page.getByRole('button', { name: '曾经使用', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: /测试药物/ }).count(), 1);
  let lookupQuery = '';
  await page.route('**/api/route2/items/find?*', (route) => {
    lookupQuery = new URL(route.request().url()).searchParams.get('q');
    return route.fulfill({
      json: {
        status: 'found',
        dataMode: 'demo',
        message: '测试位置结果',
        item: { id: 'test-item', title: '测试药物', location: '测试柜' },
      },
    });
  });
  await page.getByRole('button', { name: /测试药物/ }).click();
  await page.getByRole('button', { name: '找不到这盒药？去家庭空间查找' }).click();
  await page.getByRole('heading', { name: '家庭空间查询结果' }).waitFor();
  assert.equal(lookupQuery, '测试药物');
  assert.match(await page.getByRole('link', { name: '打开路线二中的物品位置' }).getAttribute('href'), /find=test-item/);
  await nav.getByRole('button', { name: '健康档案' }).click();
  assert.equal(await page.locator('.archive-category').count(), 6);
  await page.getByRole('button', { name: '＋ 上传新档案' }).click();
  await page
    .getByLabel('从文件选择')
    .setInputFiles({ name: 'sample.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  await page.getByLabel('档案名称').fill('本机测试报告');
  await page.getByRole('button', { name: '保存档案', exact: true }).click();
  await page.getByRole('button', { name: /本机测试报告/ }).waitFor();
  await page.reload();
  await nav.getByRole('button', { name: '健康档案' }).click();
  await page.getByRole('button', { name: /本机测试报告/ }).click();
  await page.getByRole('link', { name: '下载原文件' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await nav.getByRole('button', { name: '首页', exact: true }).click();
  await page.screenshot({ path: '.test-build/four-tab-home.png', fullPage: true });
  const mic = page.getByRole('button', { name: '长按说话', exact: true });
  await mic.focus();
  await page.keyboard.down('Space');
  await page.evaluate(() => window.testRecognition.onresult({ results: [[{ transcript: '你好，陪我聊聊' }]] }));
  await page.keyboard.up('Space');
  await page.locator('.assistant-is-open').waitFor();
  assert.equal(await page.getByText('你好，陪我聊聊', { exact: true }).count(), 1);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: fresh onboarding, four tabs, medicine CRUD/filter/persistence, archive upload/persistence, mobile overflow, controlled voice auto-send',
  );
} finally {
  await browser.close();
}
