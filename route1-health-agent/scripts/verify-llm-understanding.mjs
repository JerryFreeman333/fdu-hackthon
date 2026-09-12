#!/usr/bin/env node
/**
 * 理解层 LLM 语义仲裁的端到端验证脚本（现场演示用）。
 *
 * 用法（先在 route1-health-agent/.env 里配置好 BASE_URL / API_KEY / MODEL）：
 *   npm test && npm run verify:llm                    # 对照语料期望跑一遍
 *   npm test && npm run verify:llm -- --golden        # 额外对照 golden 基线（漂移即失败）
 *   npm test && npm run verify:llm -- --update-golden # 确认预期变化后，重录 golden 基线
 *
 * 用审查反馈里的原始反例 + 阳性对照，验证 LLM 仲裁与规则兜底的合并结果：
 *   - 否定/消失类句子必须不被记入健康档案（accepted=0）
 *   - 阳性症状/安全事件必须仍被记录
 *
 * golden 基线（tests/golden/llm-understanding-golden.json）记录每个用例在某个
 * 模型 + 提示词版本下的仲裁结果（accepted 数与标签集合）。换模型或改提示词后
 * 若结果漂移，本脚本会失败——先确认漂移是否符合预期，再 --update-golden 重录。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = resolve(__dirname, '..', 'tests', 'golden', 'llm-understanding-golden.json');
const UPDATE_GOLDEN = process.argv.includes('--update-golden');
const CHECK_GOLDEN = process.argv.includes('--golden') || UPDATE_GOLDEN;

// 极简 .env 读取（Vite 的 env 注入在 node 脚本里不存在，这里手工解析）
function loadEnvFile() {
  try {
    const text = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // 没有 .env 文件，依赖进程环境变量
  }
}
loadEnvFile();

let llm;
let understanding;
try {
  llm = await import('../.test-build/src/engine/llmUnderstanding.js');
  understanding = await import('../.test-build/src/engine/understanding.js');
} catch {
  console.error('请先运行 npm test 生成 .test-build，再执行本脚本。');
  process.exit(1);
}
const { resolveUnderstandingLlmConfig, understandElderInputWithLlm } = llm;
const { acceptedSelfClaims, understandElderInput } = understanding;

const config = resolveUnderstandingLlmConfig({
  VITE_UNDERSTANDING_LLM_BASE_URL: process.env.VITE_UNDERSTANDING_LLM_BASE_URL,
  VITE_UNDERSTANDING_LLM_API_KEY: process.env.VITE_UNDERSTANDING_LLM_API_KEY,
  VITE_UNDERSTANDING_LLM_MODEL: process.env.VITE_UNDERSTANDING_LLM_MODEL,
  VITE_UNDERSTANDING_LLM_TIMEOUT_MS: process.env.VITE_UNDERSTANDING_LLM_TIMEOUT_MS,
});
if (!config) {
  console.error('未配置理解层 LLM。请在 route1-health-agent/.env 里填写：');
  console.error('  VITE_UNDERSTANDING_LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4');
  console.error('  VITE_UNDERSTANDING_LLM_API_KEY=你的key');
  console.error('  VITE_UNDERSTANDING_LLM_MODEL=glm-4-flash');
  process.exit(1);
}
console.log(`端点: ${config.baseUrl}  模型: ${config.model}\n`);

const TODAY = '2026-09-11';
// [句子, 期望 accepted 数, 说明]
const CASES = [
  ['今天不太喘了', 0, '审查反例：好转陈述'],
  ['我毫不头晕', 0, '审查反例：强调否定'],
  ['一点都不疼', 0, '审查反例：程度否定'],
  ['压根没肿', 0, '开放集否定'],
  ['头晕好了很多', 0, '痊愈表达'],
  ['今天不那么喘了，比昨天好多了', 0, '比较级好转（LLM 仲裁改进点）'],
  ['我不是没有喘', 1, '双重否定（LLM 仲裁改进点）'],
  ['我今天有点喘', 1, '阳性对照：真实症状'],
  ['我不舒服', 1, '阳性对照：含否定字的阳性习语'],
  ['不小心摔了一跤', 1, '阳性对照：安全事件'],
  ['血糖三十', 1, '阳性对照：数值录入'],
];

let pass = 0;
let fail = 0;
const results = [];
for (const [text, expected, note] of CASES) {
  const ruleAccepted = acceptedSelfClaims(understandElderInput(text, TODAY)).length;
  const merged = await understandElderInputWithLlm(text, TODAY, [], config);
  const llmAccepted = acceptedSelfClaims(merged).length;
  const tags = [...new Set(acceptedSelfClaims(merged).flatMap((claim) => claim.tags))].sort();
  const ok = llmAccepted === expected;
  if (ok) pass += 1;
  else fail += 1;
  results.push({ text, expected, ruleAccepted, llmAccepted, tags });
  console.log(
    `${ok ? '✓' : '✗'} 「${text}」 期望记录=${expected} 规则=${ruleAccepted} LLM仲裁后=${llmAccepted}  (${note})`,
  );
}
console.log(`\n结果: ${pass}/${CASES.length} 通过`);

// golden 基线对照：同一模型 + 提示词版本下，仲裁结果不允许悄悄漂移。
if (CHECK_GOLDEN) {
  let golden = null;
  try {
    golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));
  } catch {}
  if (UPDATE_GOLDEN) {
    if (fail > 0) {
      console.error('\n用例期望未全部通过，拒绝重录 golden（先修行为或修期望）。');
      process.exit(1);
    }
    mkdirSync(dirname(GOLDEN_PATH), { recursive: true });
    writeFileSync(GOLDEN_PATH, `${JSON.stringify({ model: config.model, today: TODAY, results }, null, 2)}\n`);
    console.log(`\ngolden 基线已更新：${GOLDEN_PATH}`);
  } else if (!golden) {
    console.log('\n（尚未录制 golden 基线；运行 npm run verify:llm -- --update-golden 录制）');
  } else {
    let goldenDrift = 0;
    for (const item of results) {
      const recorded = golden.results?.find((entry) => entry.text === item.text);
      if (!recorded) {
        console.error(`✗ golden 缺少用例：「${item.text}」`);
        goldenDrift += 1;
        continue;
      }
      const same =
        recorded.llmAccepted === item.llmAccepted && JSON.stringify(recorded.tags ?? []) === JSON.stringify(item.tags);
      if (!same) {
        console.error(
          `✗ golden 漂移：「${item.text}」基线 accepted=${recorded.llmAccepted} tags=[${(recorded.tags ?? []).join(',')}]，当前 accepted=${item.llmAccepted} tags=[${item.tags.join(',')}]`,
        );
        goldenDrift += 1;
      }
    }
    if (goldenDrift > 0) {
      console.error(
        `\ngolden 对照失败（${goldenDrift} 项漂移）。确认行为变化符合预期后，运行 npm run verify:llm -- --update-golden 重录。`,
      );
      process.exit(1);
    }
    console.log(`golden 对照通过（基线模型：${golden.model}）`);
  }
}

if (fail > 0) process.exit(1);
