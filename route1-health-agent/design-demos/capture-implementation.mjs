import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { seedDemoProfile } from '../tests/helpers/demo-seed.mjs';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await seedDemoProfile(page);
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });

await page.getByRole('button', { name: /我是老人/ }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: resolve('design-demos', 'implemented-b-elder-home.png') });

await page.getByRole('button', { name: /打开 AI 助手/ }).click();
await page.getByPlaceholder(/像平时聊天一样/).waitFor();
await page.screenshot({ path: resolve('design-demos', 'implemented-b-assistant.png') });
await page.getByRole('button', { name: '返回首页' }).click();

const shareButton = page.getByRole('button', { name: /告诉家属/ });
if (await shareButton.isVisible().catch(() => false)) await shareButton.click();
await page.getByRole('button', { name: '我的' }).last().click();
await page.getByRole('button', { name: /生成家属邀请码/ }).click();
const elderText = await page.locator('body').innerText();
const inviteCode = elderText.match(/AN-\d{4}-\d{4}/)?.[0];
if (!inviteCode) throw new Error('未找到家属邀请码');

await page.getByRole('button', { name: /切换身份/ }).click();
await page.getByRole('button', { name: /我是家属/ }).click();
await page.getByPlaceholder(/AN-2026/).fill(inviteCode);
await page.getByRole('button', { name: '绑定', exact: true }).click();
await page.waitForTimeout(3400);
await page.screenshot({ path: resolve('design-demos', 'implemented-b-family-home.png') });

await page.getByRole('button', { name: '待处理', exact: true }).last().click();
await page.waitForTimeout(500);
await page.screenshot({ path: resolve('design-demos', 'implemented-b-family-tasks.png') });

if (pageErrors.length > 0) throw new Error(pageErrors.join('; '));
console.log(`captured elder home + assistant + family home/tasks; invite=${inviteCode}; page errors=0`);
await browser.close();
