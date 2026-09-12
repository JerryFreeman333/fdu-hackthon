import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const files = ['direction-a-reference.html', 'direction-b-accessible.html', 'direction-c-story.html'];
const browser = await chromium.launch({ headless: true });

for (const file of files) {
  const page = await browser.newPage({ viewport: { width: 1536, height: 960 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(pathToFileURL(resolve('design-demos', file)).href);
  await page.waitForSelector('.phones');
  const buttons = page.locator('button:visible');
  const clickCount = Math.min(await buttons.count(), 3);
  for (let index = 0; index < clickCount; index += 1) await buttons.nth(index).click();
  if (errors.length > 0) throw new Error(`${file}: ${errors.join('; ')}`);
  console.log(`${file}: ${clickCount} clicks, 0 page errors`);
  await page.close();
}

await browser.close();
