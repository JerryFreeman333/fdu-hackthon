/**
 * 浏览器黑盒：家属通知跨端可达性的端到端回归（评审 P0-1 / P0-2 修复）。
 *
 * 评审现场断裂的完整链路：老人端授权共享 → 老人报急症 → 派发引擎产出台账 →
 * 台账跨 tab 同步到家属端 → 家属端消息页出现通知内容与"我已知悉" →
 * 家属确认闭环 → 家属端刷新后绑定/授权/通知仍然存活。
 *
 * 修复前这条链路在双 tab 拓扑下从头断到尾：家属端自己的 familySharing 恒为
 * denied（授权从不广播），通知列表由本地检测结果算出空数组，台账同步了却
 * 没有任何 UI 渲染它；家属端刷新一次就丢绑定丢授权，且无法用旧邀请码恢复。
 * 373 个单测和既有的单 tab 通知测试都抓不到它——只有双 tab 拓扑能。
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
const PORT = Number(process.env.CROSSTAB_SMOKE_PORT ?? 4179);

/** 个人模式种子：空数据起步、未授权共享——评审现场最常见的人生场景。 */
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

let previewHandle = null;

function log(...args) {
  console.log('[crosstab-smoke]', ...args);
}
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))));
    p.on('error', reject);
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
  const context = await browser.newContext({ locale: 'zh-CN' });
  await context.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {}
    },
    [PROFILE_STORAGE_KEY, JSON.stringify(PERSONAL_SEED)],
  );

  const results = [];
  function check(name, ok, detail = '') {
    results.push({ name, ok });
    log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  }
  /** 轮询等待某断言为真（跨 tab 同步是异步的，固定单次等待会抖动）。 */
  async function waitFor(fn, timeoutMs = 10000, intervalMs = 300) {
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
  elderTab.on('pageerror', (err) => log('pageerror(elder):', err.message));
  const familyTab = await context.newPage();
  familyTab.on('pageerror', (err) => log('pageerror(family):', err.message));

  try {
    await elderTab.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await elderTab.getByRole('button', { name: /我是老人/ }).click({ timeout: 5000 });
    await wait(600);

    // ===== 1. 老人端生成邀请码 =====
    await elderTab.getByRole('button', { name: '我的' }).last().click();
    const inviteBtn = elderTab.getByRole('button', { name: /生成家属邀请码/ });
    await inviteBtn.waitFor({ timeout: 5000 });
    await inviteBtn.click();
    await wait(500);
    const inviteCode = await elderTab.evaluate(() => {
      const m = document.body.innerText.match(/AN-\d{4}-[A-Z2-9]{10}/);
      return m ? m[0] : null;
    });
    check('老人端生成邀请码', !!inviteCode, inviteCode || '未找到');
    if (!inviteCode) throw new Error('邀请码未生成');

    // ===== 2. 家属端跨 tab 绑定 =====
    await familyTab.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await familyTab.getByRole('button', { name: /我是家属/ }).click({ timeout: 5000 });
    const inviteInput = familyTab.locator('.family-dashboard input.chat-input');
    await inviteInput.waitFor({ timeout: 5000 });
    await inviteInput.fill(inviteCode);
    await familyTab.locator('.family-dashboard button', { hasText: '绑定' }).click();
    await familyTab.getByText('已通过邀请码绑定的家属').first().waitFor({ state: 'visible', timeout: 10000 });
    check('家属端跨 tab 绑定成功', true);

    // ===== 3. 老人端授权共享（P0-1 核心：授权必须广播到家属端） =====
    await elderTab.getByRole('button', { name: /允许共享/ }).click();
    const revokeBtn = elderTab.getByRole('button', { name: /暂停共享/ });
    check('老人端授权生效', await waitFor(() => revokeBtn.isVisible(), 5000));

    // ===== 4. 老人端报急症 → 家属端必须收到通知（修复前这里永远为空） =====
    await elderTab.getByRole('navigation').getByRole('button', { name: '首页' }).click();
    await elderTab.getByRole('button', { name: /打字聊天/ }).click();
    const chatInput = elderTab.locator('#elder-chat input.chat-input');
    await chatInput.waitFor({ timeout: 5000 });
    await chatInput.fill('我刚才在卫生间摔了一跤，现在胸口有点疼');
    await elderTab.locator('#elder-chat button', { hasText: '发送' }).click();

    // 家属端消息页出现通知卡片 + "我已知悉"（台账内容渲染 + 确认闭环）
    await familyTab.getByRole('navigation').getByRole('button', { name: '消息' }).click();
    const ackBtn = familyTab.getByRole('button', { name: '我已知悉' }).first();
    const notified = await waitFor(() => ackBtn.isVisible(), 12000);
    check('家属端消息页出现急症通知（跨端可达）', notified);
    check(
      '通知内容对家属可见',
      notified && (await familyTab.locator('body').innerText()).match(/跌倒|胸痛|摔/) !== null,
    );

    // 家属端首页 headline 绝不显示"总体正常"（修复前即使授权了也停留在"被挡住/正常"）
    await familyTab.getByRole('navigation').getByRole('button', { name: '首页' }).click();
    await wait(500);
    const homeText = await familyTab.locator('body').innerText();
    check(
      '家属端首页 headline 不再是"总体正常"',
      homeText.includes('需要立即介入') || homeText.includes('值得关注'),
      homeText.match(/今天[^,\n]{0,14}/)?.[0] ?? '',
    );

    // ===== 5. 确认闭环：逐条"我已知悉"（跌倒+胸痛会产生多张通知卡） =====
    await familyTab.getByRole('navigation').getByRole('button', { name: '消息' }).click();
    const ackAllGone = await waitFor(async () => {
      const buttons = familyTab.getByRole('button', { name: '我已知悉' });
      const count = await buttons.count();
      if (count === 0) return true;
      await buttons
        .first()
        .click()
        .catch(() => {});
      return false;
    }, 12000);
    check('逐条确认后不再有"我已知悉"待办', ackAllGone);

    // ===== 6. 家属端刷新存活（P0-2）：绑定/授权/通知都在，不回到绑定门 =====
    await familyTab.reload({ waitUntil: 'domcontentloaded' });
    await wait(1200);
    const reloadedText = await familyTab.locator('body').innerText();
    check(
      '刷新后仍保持家属身份与绑定（不回到绑定门）',
      !reloadedText.includes('先完成家庭绑定') && reloadedText.includes('已通过邀请码绑定的家属'),
    );
    await familyTab.getByRole('navigation').getByRole('button', { name: '消息' }).click();
    await wait(600);
    const afterReloadText = await familyTab.locator('body').innerText();
    check(
      '刷新后通知台账仍可见且标注已确认',
      (afterReloadText.includes('跌倒') || afterReloadText.includes('胸痛')) && afterReloadText.includes('确认已知悉'),
    );

    // ===== 7. 老人端刷新后授权仍在（P0-2）：派发闸门不因刷新关闭 =====
    await elderTab.reload({ waitUntil: 'domcontentloaded' });
    await wait(1200);
    await elderTab.getByRole('button', { name: '我的' }).last().click();
    const stillGranted = await waitFor(() => elderTab.getByRole('button', { name: /暂停共享/ }).isVisible(), 6000);
    check('老人端刷新后共享授权仍在', stillGranted);
  } catch (err) {
    log('错误:', err instanceof Error ? err.message : String(err));
    check('完成所有断言', false, err instanceof Error ? err.message : String(err));
  } finally {
    await elderTab.screenshot({ path: resolve(ROOT, 'tests', 'crosstab-elder.png'), fullPage: true }).catch(() => {});
    await familyTab.screenshot({ path: resolve(ROOT, 'tests', 'crosstab-family.png'), fullPage: true }).catch(() => {});
    await context.close();
    await browser.close();
  }

  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  log(`总计: ${passed}/${total} 通过`);
  stopPreview();
  if (passed < total) process.exit(1);
  // CI 的公共信令可达时，PeerJS 的 WebSocket 会一直挂着事件循环——断言跑完也必须强制退出。
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  stopPreview();
  process.exit(1);
});
