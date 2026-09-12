import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { DEMO_PROFILE_SEED, PROFILE_STORAGE_KEY } from './helpers/demo-seed.mjs';

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const family = await context.newPage();
  await family.goto((process.env.TEST_BASE_URL || 'http://127.0.0.1:5173/'));
  await family.evaluate(({ key, profile }) => localStorage.setItem(key, JSON.stringify(profile)), {
    key: PROFILE_STORAGE_KEY, profile: { ...DEMO_PROFILE_SEED, dataMode: 'demo', preferredRole: 'family' },
  });
  await family.reload();
  await family.getByRole('heading', { name: /王强/ }).waitFor();
  assert.equal(await family.locator('.family-feature').count(), 4);
  assert.deepEqual(await family.locator('.mobile-tab').allTextContents(), ['首页', '周报', '消息', '我的']);
  await family.getByRole('navigation').getByRole('button', { name: '我的', exact: true }).click();
  await family.getByRole('button', { name: /账号与登录/ }).click();
  await family.getByRole('heading', { name: '微信授权登录', exact: true }).waitFor();
  await family.getByRole('navigation').getByRole('button', { name: '首页', exact: true }).click();
  await family.screenshot({ path: '.test-build/family-management-home.png', fullPage: true });
  const elder = await context.newPage();
  await elder.goto((process.env.TEST_BASE_URL || 'http://127.0.0.1:5173/'));
  await elder.getByRole('button', { name: '切换身份', exact: true }).click();
  await elder.getByRole('button', { name: /我是老人/ }).click();
  const nav = family.getByRole('navigation', { name: '主要导航' });
  await family.getByRole('button', { name: /药物建档.*查看/ }).click();
  await family.getByRole('button', { name: /氨氯地平/ }).click();
  await family.getByRole('button', { name: '编辑', exact: true }).click();
  await family.getByLabel('服用时间（如 08:00、20:00）').fill('09:15（测试记录）');
  await family.getByRole('button', { name: /保存/ }).click();
  await family.getByText('09:15（测试记录）', { exact: true }).waitFor();
  await elder.getByRole('navigation').getByRole('button', { name: '药物', exact: true }).click();
  await elder.getByRole('button', { name: /09:15（测试记录）/ }).waitFor();
  await family.getByRole('button', { name: '← 返回首页', exact: true }).click();
  await family.getByRole('button', { name: /档案管理.*整理/ }).click();
  await family.getByRole('button', { name: /年度健康体检摘要（上次记录）/ }).click();
  await family.getByRole('button', { name: '编辑档案', exact: true }).click();
  await family.getByLabel('档案名称', { exact: true }).fill('家属整理的体检报告');
  await family.getByRole('button', { name: '保存档案', exact: true }).click();
  await family.getByRole('button', { name: /家属整理的体检报告/ }).waitFor();
  await family.reload();
  await family.getByRole('button', { name: /档案管理.*整理/ }).click();
  await family.getByRole('button', { name: /家属整理的体检报告/ }).waitFor();
  await nav.getByRole('button', { name: '消息', exact: true }).click();
  await family.getByRole('heading', { name: '消息', exact: true }).waitFor();
  await nav.getByRole('button', { name: '周报', exact: true }).click();
  const range = await family.locator('h1').innerText();
  await family.getByRole('button', { name: '上一周', exact: true }).click();
  assert.notEqual(await family.locator('h1').innerText(), range);
  await family.getByRole('button', { name: '下一周', exact: true }).click();
  assert.equal(await family.locator('h1').innerText(), range);
  await nav.getByRole('button', { name: '首页', exact: true }).click();
  await family.getByRole('button', { name: /空间胶囊.*家庭环境/ }).click();
  const target = await family.getByRole('link', { name: /进入家庭空间/ }).getAttribute('href');
  assert.equal(new URL(target).searchParams.get('view'), 'family-actions');
  await nav.getByRole('button', { name: '首页', exact: true }).click();
  await family.getByRole('button', { name: /隐私设置.*数据共享/ }).click();
  await family.getByRole('button', { name: '暂停老人共享' }).click();
  await nav.getByRole('button', { name: '首页', exact: true }).click();
  await family.getByRole('button', { name: /药物建档.*查看/ }).click();
  await family.getByText('请先绑定家人，并由父母授权共享药物资料。').waitFor();
  console.log('PASS family navigation, medication propagation, archive edit/persistence, route2 link, consent gate');
} finally {
  await browser.close();
}
