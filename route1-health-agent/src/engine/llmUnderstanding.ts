/**
 * 理解层的 LLM 语义仲裁。
 *
 * 分工与 README 承诺一致：规则引擎继续负责标签/数值抽取、人物归属、隐私边界、
 * 分级与回复；LLM 只仲裁一件规则引擎永远做不完的事——
 * 「这句话里的症状到底是在发生、已经消失/被否认，还是假设/不确定」。
 * 否定与程度副词在中文里是开放集合（不太喘、毫不头晕、一点都不疼、压根没肿……），
 * 用关键词表穷举已被两轮审查证明追不上真实口语，这一步必须交给真实语言理解。
 *
 * Fail-closed 原则：
 * - 未配置、超时、网络错误、返回不合法 → 一律回落到规则结果，绝不阻塞、绝不静默改变语义；
 * - privacy intent 为 private / no_record 的输入在调用方被拦截，不发送给外部模型；
 * - 规则里强的词汇信号（可能/好像 → uncertain，如果/万一 → hypothetical，差点 → near_miss）
 *   不被 LLM 覆盖，LLM 只仲裁「发生了 vs 没发生」这一个轴。
 */
import type { ChatMessage, ClaimStatus } from '../types';
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

const SYSTEM_PROMPT = `你是中文口语理解器，服务于老人健康助手。给你一段老人说的话（已按子句编号），请对每个子句判断健康事件状态：
- occurred：症状/事件确实正在发生或已如陈述发生。注意：含否定字但语义为阳性的固定说法算 occurred，例如"喘不上气""没睡好""睡不好""不小心摔了一跤""腿没劲"。
- negated：症状被否认、已消失或明显好转，例如"不太喘了""毫不头晕""一点都不疼""头晕好了""肿消了""没有胸闷"。
- hypothetical：假设或提问，例如"如果头晕怎么办""怎么预防摔跤"。
- uncertain：说话人自己不确定，例如"可能有点喘""不确定是不是晕"。
- near_miss：差点发生但没发生，例如"差点摔倒""差点晕倒"。
只输出 JSON数组，格式 [{"i":0,"s":"occurred"},{"i":1,"s":"negated"}]，i 是子句编号。不要输出任何其他文字。`;

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/** 对 OpenAI 兼容 /chat/completions 端点发起一次小请求；任何失败返回 null，由调用方回落规则。 */
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
    const judgments = new Map<number, ClaimStatus>();
    for (const item of raw) {
      if (typeof item !== 'object' || item === null) continue;
      const record = item as { i?: unknown; s?: unknown };
      const index = typeof record.i === 'number' ? record.i : Number(record.i);
      if (!Number.isInteger(index) || index < 0 || index >= clauseCount) continue;
      if (typeof record.s !== 'string') continue;
      const status = record.s.trim().toLowerCase();
      if (!STATUS_VALUES.includes(status as ClaimStatus)) continue;
      judgments.set(index, status as ClaimStatus);
    }
    if (judgments.size === 0) return null;
    return [...judgments.entries()].map(([clauseIndex, status]) => ({ clauseIndex, status }));
  } catch {
    return null;
  }
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

/**
 * 完整理解入口：先按规则理解，再把 LLM 的肯否仲裁合并进去。
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

  const overrides = new Map<string, ClaimStatus>();
  for (const judgment of judgments) {
    const clause = clauses[judgment.clauseIndex];
    if (!clause) continue;
    const parsed = parseElderInput(clause);
    const hasHealthValue = extractHealthValues(clause).length > 0;
    const ruleStatus = statusFromText(clause, parsed.tags, hasHealthValue);
    const merged = mergeClauseStatus(ruleStatus, judgment.status);
    if (merged !== ruleStatus && !overrides.has(clause)) overrides.set(clause, merged);
  }
  if (overrides.size === 0) return understandElderInput(text, today, recentMessages);
  return understandElderInputWithOverrides(text, today, recentMessages, overrides);
}
