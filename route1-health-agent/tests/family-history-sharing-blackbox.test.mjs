/**
 * 浏览器黑盒：既往事实的逐条授权、脱敏与撤回（用户确认的产品决策 4）。
 *
 * 覆盖真实链路：
 * 老人聊天说出一条带精确日期、姓名、手机号、医院名的既往事实 →
 * 老人“健康”页出现既往卡片 → 未绑定时授权按钮禁用 →
 * 绑定后点“允许查看摘要” → 家属首页出现该条，只到月份，不含原文/PII →
 * 改为“含脱敏原话” → 家属看到的是替换后的文本 →
 * 点“撤回” → 家属端卡片消失。
 *
 * 这条链路最容易在“单人 demo 能跑、双 tab 就断”的地方失效：
 * 授权只存在老人端 localStorage、派生视图必须能跨 BroadcastChannel 到达家属端。
 */
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PROFILE_STORAGE_KEY } from './helpers/demo-seed.mjs';
import { startPreview as startPreviewShared } from './helpers/preview-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const PORT = Number(process.env.HISTORY_SHARE_SMOKE_PORT ?? 4182);

const PERSONAL_SEED = {
  version: 1,
  dataMode: 'personal',
  profile: {
    name: '李奶奶',
    age: 78,
    conditions: [],
    medications: [],
    familyContact: '女儿 李芳',
    familyPhone: '13911112222',
    mobility: 'independent',
    usesCane: false,
    nightVision: 'normal',
    cognition: 'stable',
    familySharing: 'denied',
  },
};

const HISTORY_TEXT = '2025年3月18日我因为喘得厉害住过仁爱医院电话13800138000陪同陈小云';

let previewHandle = null;

function log(...args) {
  console.log('[history-share-smoke]', ...args);
}
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))));
    child.on('error', reject);
  });
}
async function ensureBuild() {
  if (!existsSync(DIST) || !existsSync(resolve(DIST, 'index.html'))) {
    log('dist/ 不存在，先执行 npm run build …');
    await run('npm', ['run', 'build']);
  }
}
async function startPreview() {
  previewHandle = await startPreviewShared({ port: PORT, prefix: '[preview]' });
}
function stopPreview() {
  previewHandle?.stop();
  previewHandle = null;
}

async function main() {
  await ensureBuild();
  await startPreview();
  log(`preview 服务已就绪 (http://127.0.0.1:${PORT})`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    viewport: { width: 390, height: 844 },
  });
  await context.route(/peerjs\.com/, (route) => route.abort());
  await context.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
        Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined });
      } catch {}
    },
    [PROFILE_STORAGE_KEY, JSON.stringify(PERSONAL_SEED)],
  );

  const results = [];
  function check(name, ok, detail = '') {
    results.push({ name, ok });
    log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  }
  async function waitFor(fn, timeoutMs = 12000, intervalMs = 300) {
    const deadline = Date.now() + timeoutMs;
    let last = false;
    while (Date.now() < deadline) {
      last = await fn().catch(() => false);
      if (last) return true;
      await wait(intervalMs);
    }
    return last;
  }

  const elderTab = await context.newPage();
  elderTab.on('pageerror', (error) => log('pageerror(elder):', error.message));
  const familyTab = await context.newPage();
  familyTab.on('pageerror', (error) => log('pageerror(family):', error.message));
  for (const page of [elderTab, familyTab]) {
    await page.clock.install({ time: new Date('2026-11-16T04:00:00Z') });
  }

  try {
    await elderTab.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await elderTab.getByRole('button', { name: /我是老人/ }).click({ timeout: 5000 });
    await wait(600);

    // ===== 1. 老人说出一条带 PII 的既往事实 =====
    await elderTab.getByRole('button', { name: /打字聊天/ }).click();
    const chatInput = elderTab.locator('#elder-chat input.chat-input');
    await chatInput.waitFor({ timeout: 5000 });
    await chatInput.fill(HISTORY_TEXT);
    await elderTab.locator('#elder-chat button', { hasText: '发送' }).click();
    const historyRecorded = await waitFor(async () => {
      const text = await elderTab.locator('body').innerText();
      return text.includes('既往情况') || text.includes('既往');
    }, 10000);
    check('老人端把历史事实写入既往账本', historyRecorded);
    await elderTab.getByRole('button', { name: '返回首页' }).click();

    // ===== 2. 未绑定家属时，授权按钮必须禁用，而不是假装授权成功 =====
    await elderTab.getByRole('navigation').getByRole('button', { name: '健康' }).click();
    await elderTab.getByRole('heading', { name: '既往情况 · 家属授权' }).waitFor({ state: 'visible', timeout: 8000 });
    const blockedButton = elderTab.getByRole('button', { name: '允许查看摘要' }).first();
    const blockedState = await waitFor(() => blockedButton.isVisible(), 5000);
    check('未绑定家属时显示授权入口但保持禁用', blockedState && (await blockedButton.isDisabled()));
    check('未绑定文案明确说明前置条件', (await elderTab.locator('body').innerText()).includes('先绑定家属后才能授权'));

    // ===== 3. 绑定家属 =====
    await elderTab.getByRole('button', { name: '我的' }).last().click();
    await elderTab.getByRole('button', { name: /生成家属邀请码/ }).click();
    await wait(500);
    const inviteCode = await elderTab.evaluate(() => {
      const match = document.body.innerText.match(/AN-\d{4}-[A-Z2-9]{10}/);
      return match ? match[0] : null;
    });
    check('老人端生成家属邀请码', Boolean(inviteCode), inviteCode || '未找到');
    if (!inviteCode) throw new Error('邀请码未生成');

    await familyTab.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await familyTab.getByRole('button', { name: /我是家属/ }).click({ timeout: 5000 });
    const inviteInput = familyTab.locator('.family-dashboard input.chat-input');
    await inviteInput.waitFor({ timeout: 5000 });
    await inviteInput.fill(inviteCode);
    await familyTab.locator('.family-dashboard button', { hasText: '绑定' }).click();
    await familyTab.getByText('已通过邀请码绑定的家属').first().waitFor({ state: 'visible', timeout: 10000 });
    check('家属端绑定成功', true);

    // ===== 4. 授权摘要：家属只能看到年月，不能看到原文与 PII =====
    await elderTab.getByRole('navigation').getByRole('button', { name: '健康' }).click();
    const grantSummary = elderTab.getByRole('button', { name: '允许查看摘要' }).first();
    await grantSummary.waitFor({ state: 'visible', timeout: 8000 });
    await grantSummary.click();
    await elderTab.getByRole('group', { name: '授权预览' }).waitFor({ state: 'visible' });
    check('授权前必须预览，家属此时仍不可见', (await familyTab.locator('.shared-history-card').count()) === 0);
    await elderTab.getByRole('button', { name: '确认授权，7 天有效' }).click();

    await familyTab.getByRole('navigation').getByRole('button', { name: '首页' }).click();
    const summaryVisible = await waitFor(async () => {
      const text = await familyTab.locator('body').innerText();
      return text.includes('老人授权查看的既往情况') && text.includes('2025-03（仅到月）');
    }, 12000);
    check('家属端出现摘要授权卡片，且只到月份', summaryVisible);
    const summaryText = await familyTab.locator('body').innerText();
    check(
      '摘要不含精确日期、医院、手机号与姓名',
      !/2025-03-18|2025年3月18日|仁爱医院|13800138000|李芳/.test(summaryText),
    );
    check('摘要明确说明原话未展示', summaryText.includes('老人只授权了摘要'));

    // ===== 5. 升级为脱敏原话：PII 必须被替换，不能原样跨端 =====
    await elderTab.getByRole('button', { name: '含脱敏原话' }).click();
    await elderTab.getByLabel('还要隐藏的姓名、地点（用逗号分隔）').fill('陈小云');
    const previewText = await elderTab.getByRole('group', { name: '授权预览' }).innerText();
    check('预览先遮蔽手机号、医院和补充姓名', !/仁爱医院|13800138000|陈小云|2025年3月18日/.test(previewText));
    await elderTab.getByRole('button', { name: '确认授权，7 天有效' }).click();
    const deidentifiedVisible = await waitFor(async () => {
      const text = await familyTab.locator('body').innerText();
      return text.includes('[医疗机构已隐藏]') && text.includes('[手机号已隐藏]');
    }, 12000);
    check('家属端收到脱敏原话（医院/手机号已替换）', deidentifiedVisible);
    const deidentifiedText = await familyTab.locator('body').innerText();
    check(
      '脱敏原话仍不含姓名、医院、手机号与精确日期',
      !/仁爱医院|13800138000|李芳|陈小云|2025-03-18|2025年3月18日/.test(deidentifiedText),
    );
    await familyTab.reload({ waitUntil: 'domcontentloaded' });
    check('家属刷新后授权仍可见', await waitFor(() => familyTab.locator('.shared-history-card').isVisible()));
    check(
      '家属刷新不覆盖老人授权',
      await elderTab.evaluate(() => {
        const grants = JSON.parse(localStorage.getItem('ankang-route1-history-grants-v1') ?? '[]');
        return grants.length === 1 && grants[0].scope === 'summary_with_text' && !grants[0].revokedAt;
      }),
    );
    await familyTab.evaluate(() => localStorage.removeItem('ankang-route1-shared-history-v1'));
    await familyTab.reload({ waitUntil: 'domcontentloaded' });
    check(
      '收件缓存丢失后能向老人端重新请求授权快照',
      await waitFor(() => familyTab.locator('.shared-history-card').isVisible()),
    );

    // ===== 6. 撤回后必须立刻消失，而不是留在另一台设备上 =====
    await elderTab.getByRole('button', { name: '撤回' }).click();
    const revoked = await waitFor(async () => {
      const text = await familyTab.locator('body').innerText();
      return !text.includes('老人授权查看的既往情况');
    }, 12000);
    check('撤回后家属端卡片消失', revoked);
    check(
      '撤回也删除本地派生内容',
      await waitFor(() =>
        familyTab.evaluate(() => {
          const snapshot = JSON.parse(localStorage.getItem('ankang-route1-shared-history-v1') ?? 'null');
          return !snapshot || snapshot.views.length === 0;
        }),
      ),
    );
    await familyTab.reload({ waitUntil: 'domcontentloaded' });
    check('撤回后刷新不会恢复旧内容', (await familyTab.locator('.shared-history-card').count()) === 0);
    await elderTab.getByRole('button', { name: '允许查看摘要' }).click();
    await elderTab.getByRole('button', { name: '取消', exact: true }).click();
    check('取消授权预览不产生授权', (await familyTab.locator('.shared-history-card').count()) === 0);
    await elderTab.getByRole('button', { name: '允许查看摘要' }).click();
    await elderTab.getByRole('button', { name: '确认授权，7 天有效' }).click();
    await waitFor(() => familyTab.locator('.shared-history-card').isVisible());
    await elderTab
      .locator('.history-sharing-panel')
      .screenshot({ path: resolve(ROOT, 'tests', 'history-share-panel.png') });
    await familyTab
      .locator('.shared-history-card')
      .screenshot({ path: resolve(ROOT, 'tests', 'history-share-card.png') });
    for (const page of [familyTab, elderTab]) {
      await page.clock.setSystemTime(new Date('2026-11-23T04:00:00Z'));
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    }
    check(
      '到期后家属自动隐藏内容并清理缓存',
      await waitFor(
        async () =>
          (await familyTab.locator('.shared-history-card').count()) === 0 &&
          (await familyTab.evaluate(() => {
            const snapshot = JSON.parse(localStorage.getItem('ankang-route1-shared-history-v1') ?? 'null');
            return !snapshot || snapshot.views.length === 0;
          })),
      ),
    );
    await elderTab.getByRole('button', { name: '允许查看摘要' }).click();
    await elderTab.getByRole('button', { name: '确认授权，7 天有效' }).click();
    check(
      '到期后须由老人重新授权才恢复显示',
      await waitFor(() => familyTab.locator('.shared-history-card').isVisible()),
    );
    for (const [name, page] of [
      ['老人', elderTab],
      ['家属', familyTab],
    ]) {
      check(
        `${name}界面在390像素宽度下没有横向溢出`,
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      );
    }
    await familyTab.getByRole('navigation').getByRole('button', { name: '我的', exact: true }).click();
    await familyTab.getByRole('button', { name: /家庭连接与绑定/ }).click();
    await familyTab.getByRole('button', { name: /解除.*绑定/ }).click();
    check(
      '解绑后清除历史派生缓存',
      await waitFor(() =>
        familyTab.evaluate(() => {
          return localStorage.getItem('ankang-route1-shared-history-v1') === 'null';
        }),
      ),
    );
  } catch (error) {
    log('错误:', error instanceof Error ? error.message : String(error));
    check('完成所有断言', false, error instanceof Error ? error.message : String(error));
  } finally {
    await elderTab
      .screenshot({ path: resolve(ROOT, 'tests', 'history-share-elder.png'), fullPage: true })
      .catch(() => {});
    await familyTab
      .screenshot({ path: resolve(ROOT, 'tests', 'history-share-family.png'), fullPage: true })
      .catch(() => {});
    await context.close();
    await browser.close();
  }

  const passed = results.filter((result) => result.ok).length;
  log(`总计: ${passed}/${results.length} 通过`);
  stopPreview();
  if (passed < results.length) process.exit(1);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  stopPreview();
  process.exit(1);
});
