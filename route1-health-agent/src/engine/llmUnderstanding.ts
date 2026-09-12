/**
 * 理解层的 LLM 语义仲裁。
 *
 * 分工与 README 承诺一致：规则引擎继续负责数值抽取、人物归属、隐私边界、
 * 分级与回复；LLM 仲裁两件规则引擎永远做不完的事——
 * 1. 肯否轴：「这句话里的症状到底是在发生、已经消失/被否认，还是假设/不确定」。
 *    否定与程度副词在中文里是开放集合（不太喘、毫不头晕、一点都不疼、压根没肿……），
 *    用关键词表穷举已被两轮审查证明追不上真实口语；
 * 2. 标签轴：「这句话是否提到了某个症状」。agent.ts 的 INTENT_RULES 各症状窗口宽窄
 *    不一致（头晕 {0,2}、胸口痛 {0,5}、摔倒要求紧邻），否定/程度词插在症状词中间或
 *    距离超出窗口时（“头一点都不晕了”“摔是没摔”），标签识别整体失效——整句话
 *    不产生任何 claim、不追问、界面零反馈。这一层决定“有没有 claim”，比肯否更基础、
 *    出错更难被察觉，因此同样交给真实语言理解；规则识别结果只做下限（LLM 只增不删）。
 *
 * Fail-closed 原则：
 * - 未配置、超时、网络错误、返回不合法 → 一律回落到规则结果，绝不阻塞、绝不静默改变语义；
 * - privacy intent 为 private / no_record 的输入在调用方被拦截，不发送给外部模型；
 * - 规则里强的词汇信号（可能/好像 → uncertain，如果/万一 → hypothetical，差点 → near_miss）
 *   不被 LLM 覆盖；肯否轴在 occurred/negated 之间双向仲裁；
 * - 标签轴：规则已识别的标签永不被 LLM 删除（反向漏标导致的静默丢弃正是本层要消灭的 bug 类）。
 */
import type { ChatMessage, ClaimStatus, SymptomTag } from '../types';
import { SYMPTOM_LABELS } from '../types';
import { extractHealthValues } from './extract';
import { parseElderInput } from './agent';
import {
  splitClauses,
  statusFromText,
  understandElderInput,
  understandElderInputWithOverrides,
  type StructuredElderInput,
} from './understanding';

export interface UnderstandingLlmConfig {
  /** OpenAI 兼容根地址，例如 https://open.bigmodel.cn/api/paas/v4 */
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export interface ClauseStatusJudgment {
  clauseIndex: number;
  status: ClaimStatus;
  /** LLM 识别出的症状标签；缺省 = 未提供（合并时视同空集，只增不删）。 */
  tags?: SymptomTag[];
}

const STATUS_VALUES: ClaimStatus[] = ['occurred', 'negated', 'hypothetical', 'uncertain', 'near_miss'];
const MAX_CLAUSES = 12;
const MAX_INPUT_CHARS = 500;
const DEFAULT_TIMEOUT_MS = 8000;

/** 从环境读取理解层 LLM 配置；未配置 baseUrl/key 时返回 null（= 纯规则模式）。
 *  环境无关：env 由调用方传入（浏览器端传 import.meta.env，测试传显式对象）。 */
export function resolveUnderstandingLlmConfig(env: {
  VITE_UNDERSTANDING_LLM_BASE_URL?: string;
  VITE_UNDERSTANDING_LLM_API_KEY?: string;
  VITE_UNDERSTANDING_LLM_MODEL?: string;
  VITE_UNDERSTANDING_LLM_TIMEOUT_MS?: string;
}): UnderstandingLlmConfig | null {
  const baseUrl = env.VITE_UNDERSTANDING_LLM_BASE_URL?.trim();
  const apiKey = env.VITE_UNDERSTANDING_LLM_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  } catch {
    return null;
  }
  const timeoutRaw = Number(env.VITE_UNDERSTANDING_LLM_TIMEOUT_MS);
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
    model: env.VITE_UNDERSTANDING_LLM_MODEL?.trim() || 'glm-4-flash',
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw >= 1000 ? Math.min(timeoutRaw, 30000) : DEFAULT_TIMEOUT_MS,
  };
}

export type { PrivacyIntent } from './privacy';

/**
 * 隐私门控：标记为 private / no_record 的输入永远不发送给外部模型，
 * 即使理解层 LLM 已配置——这些话的肯否判断交给本地规则兜底。
 */
export function canUseLlmUnderstanding(
  intent: 'none' | 'private' | 'no_record' | 'share_family',
  configured: boolean,
): boolean {
  return configured && intent !== 'private' && intent !== 'no_record';
}

const TAG_GUIDE = `可选标签（只能从这个列表里选，不涉及任何症状就给空数组 []）：
fatigue=累/乏力/没劲/腿软; dyspnea=喘/气短/憋气/胸闷; poorSleep=睡不好/睡不着/失眠/起夜; edema=脚肿/腿肿/浮肿/鞋紧脚挤;
dizziness=头晕/头昏/眩晕/站不稳/眼前发黑; medicationMissed=忘吃药/漏吃药/没吃药; pain=疼/痛/不舒服/难受;
moodLow=心情烦闷/孤独/没意思; fall=摔倒/跌倒/摔了一跤; bpHigh=血压高; spo2Low=血氧低; hrHigh=心跳快/心率快;
hrLow=心跳慢/心率慢; glucoseHigh=血糖高; glucoseLow=血糖低; chestPain=胸痛/胸口痛/心口痛;
neuroChange=突然说话不清/嘴角歪/一侧肢体无力发麻/突然看不清。`;

const SYSTEM_PROMPT = `你是中文口语理解器，服务于老人健康助手。给你一段老人说的话（已按子句编号），请对每个子句输出健康事件状态 s 和症状标签 t：
- s=occurred：症状/事件确实正在发生或已如陈述发生。注意：含否定字但语义为阳性的固定说法算 occurred，例如"喘不上气""没睡好""睡不好""不小心摔了一跤""腿没劲"。
- s=negated：症状被否认、已消失或明显好转，例如"不太喘了""毫不头晕""一点都不疼""头晕好了""肿消了""没有胸闷""头一点都不晕了""摔是没摔"。
- s=hypothetical：假设或提问，例如"如果头晕怎么办""怎么预防摔跤"。
- s=uncertain：说话人自己不确定，例如"可能有点喘""不确定是不是晕"。
- s=near_miss：差点发生但没发生，例如"差点摔倒""差点晕倒"。
- t：这个子句涉及哪些症状，从下面的固定列表里选（可多个）。让步句式"X是没X，就是Y"里 X 和 Y 涉及的症状都要标，不要因为症状被否认就漏标。
${TAG_GUIDE}
只输出 JSON数组，格式 [{"i":0,"s":"occurred","t":["dizziness"]},{"i":1,"s":"negated","t":[]}]，i 是子句编号。不要输出任何其他文字。`;

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/** 对 OpenAI 兼容 /chat/completions 端点发起一次小请求，同时仲裁肯否与症状标签；任何失败返回 null，由调用方回落规则。 */
export async function judgeClauseStatuses(
  clauses: string[],
  config: UnderstandingLlmConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<ClauseStatusJudgment[] | null> {
  if (clauses.length === 0 || clauses.length > MAX_CLAUSES) return null;
  const userText = clauses.map((clause, index) => `${index}. ${clause}`).join('\n');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        // 推理类模型（如 MiniMax-M3）的思考 token 计入 completion，上限要放宽，
        // 否则思考没结束就被截断，正文里的 JSON 永远出不来。
        max_tokens: 2000,
        stream: false,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userText },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;
    return parseJudgmentJson(content, clauses.length);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 从模型回复里稳健地抠出 JSON 数组；任何字段不合法都丢弃对应条目。 */
export function parseJudgmentJson(content: string, clauseCount: number): ClauseStatusJudgment[] | null {
  // 推理模型（MiniMax-M3 等）会在正文前输出 <think>…</think>；思考文本里可能出现
  // 方括号，必须先剥掉，否则会干扰 JSON 抽取。
  const stripped = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    const raw = JSON.parse(stripped.slice(start, end + 1)) as unknown;
    if (!Array.isArray(raw)) return null;
    const judgments = new Map<number, ClauseStatusJudgment>();
    for (const item of raw) {
      if (typeof item !== 'object' || item === null) continue;
      const record = item as { i?: unknown; s?: unknown; t?: unknown };
      const index = typeof record.i === 'number' ? record.i : Number(record.i);
      if (!Number.isInteger(index) || index < 0 || index >= clauseCount) continue;
      if (typeof record.s !== 'string') continue;
      const status = record.s.trim().toLowerCase();
      if (!STATUS_VALUES.includes(status as ClaimStatus)) continue;
      const tags = parseJudgedTags(record.t);
      judgments.set(index, { clauseIndex: index, status: status as ClaimStatus, ...(tags ? { tags } : {}) });
    }
    if (judgments.size === 0) return null;
    return [...judgments.values()];
  } catch {
    return null;
  }
}

const KNOWN_TAGS: ReadonlySet<string> = new Set(Object.keys(SYMPTOM_LABELS));

/** 标签必须落在固定枚举内；空数组/全非法视同未提供（合并时只增不删，缺席 = 不补充）。 */
function parseJudgedTags(raw: unknown): SymptomTag[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const tags = [...new Set(raw.filter((tag): tag is SymptomTag => typeof tag === 'string' && KNOWN_TAGS.has(tag)))];
  return tags.length > 0 ? tags : undefined;
}

/**
 * 规则状态与 LLM 判断的合并策略：
 * - 规则的强词汇信号（假设/不确定/擦边）不被 LLM 覆盖；
 * - LLM 与规则结论不同时，肯否轴双向仲裁：规则说发生、LLM 说没有 → 采 LLM；
 *   规则说没有、LLM 说发生 → 采 LLM（双重否定等规则盲区）。
 */
export function mergeClauseStatus(rule: ClaimStatus, llm: ClaimStatus): ClaimStatus {
  if (rule === 'hypothetical' || rule === 'uncertain' || rule === 'near_miss') return rule;
  if (rule === llm) return rule;
  if (rule === 'occurred' && llm === 'negated') return llm;
  if (rule === 'negated' && llm === 'occurred') return llm;
  return rule;
}

/** 标签合并：规则识别出的标签是下限，LLM 只补充、不删除——
 *  反向（LLM 漏标导致症状被静默丢弃）正是本层要消灭的 bug 类。 */
export function mergeClauseTags(ruleTags: SymptomTag[], llmTags: SymptomTag[] | undefined): SymptomTag[] {
  return [...new Set([...ruleTags, ...(llmTags ?? [])])];
}

/**
 * LLM 补出规则漏识别的标签时，规则状态是在"看不见这些症状"的前提下算出来的，
 * 对新补的症状没有发言权，肯否以 LLM 判断为准；但规则的强词汇信号
 * （可能/好像 → uncertain，如果/万一 → hypothetical，差点 → near_miss）仍然优先，
 * 避免假设句因标签补识别而被误记录。
 */
export function mergeClauseStatusWithAddedTags(rule: ClaimStatus, llm: ClaimStatus): ClaimStatus {
  if (rule === 'hypothetical' || rule === 'uncertain' || rule === 'near_miss') return rule;
  return llm;
}

/**
 * 完整理解入口：先按规则理解，再把 LLM 的标签仲裁与肯否仲裁合并进去（一次调用同时仲裁两个轴）。
 * LLM 任何环节失败都原样返回规则结果——理解层的可用性永远不差于纯规则模式。
 */
export async function understandElderInputWithLlm(
  text: string,
  today: string,
  recentMessages: ChatMessage[] = [],
  config: UnderstandingLlmConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<StructuredElderInput> {
  const trimmed = text.trim();
  const clauses = splitClauses(trimmed);
  const eligible = clauses.length > 0 && clauses.length <= MAX_CLAUSES && trimmed.length <= MAX_INPUT_CHARS;
  if (!eligible) return understandElderInput(text, today, recentMessages);

  const judgments = await judgeClauseStatuses(clauses, config, fetchImpl);
  if (!judgments) return understandElderInput(text, today, recentMessages);

  const statusOverrides = new Map<string, ClaimStatus>();
  const tagOverrides = new Map<string, SymptomTag[]>();
  for (const judgment of judgments) {
    const clause = clauses[judgment.clauseIndex];
    if (!clause) continue;
    const parsed = parseElderInput(clause);
    const hasHealthValue = extractHealthValues(clause).length > 0;
    const ruleStatus = statusFromText(clause, parsed.tags, hasHealthValue);
    const addedTags = (judgment.tags ?? []).filter((tag) => !parsed.tags.includes(tag));
    if (addedTags.length > 0) {
      if (!tagOverrides.has(clause)) tagOverrides.set(clause, mergeClauseTags(parsed.tags, judgment.tags));
      // 规则状态对它没看见的症状没有发言权：肯否以 LLM 为准（强词汇信号除外），并固定下来。
      if (!statusOverrides.has(clause))
        statusOverrides.set(clause, mergeClauseStatusWithAddedTags(ruleStatus, judgment.status));
      continue;
    }
    const merged = mergeClauseStatus(ruleStatus, judgment.status);
    if (merged !== ruleStatus && !statusOverrides.has(clause)) statusOverrides.set(clause, merged);
  }
  if (statusOverrides.size === 0 && tagOverrides.size === 0) return understandElderInput(text, today, recentMessages);
  return understandElderInputWithOverrides(text, today, recentMessages, statusOverrides, tagOverrides);
}
