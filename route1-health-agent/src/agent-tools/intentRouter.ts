import type { AgentToolInvocation } from './types';

const LOCATION_INTENT = /(找|放哪|放在|在哪|哪里|位置|带我去|拿药)/;
const MEDICINE_TERMS = /(降压药|药盒|药片|药物|常用药|药)/;

/**
 * Agent 工具路由的本地安全下限。
 * 只在用户明确询问位置时调用 Home Twin；“药怎么吃/几点吃”仍留在路线一健康链路。
 * 后续 LLM function calling 也必须输出同一个 AgentToolInvocation 契约。
 */
export function routeAgentToolIntent(text: string): AgentToolInvocation | null {
  const normalized = text.trim();
  // Health/safety language must stay in the health assessment chain even when it also asks for an item.
  if (/(胸痛|胸口痛|喘不过气|呼吸困难|晕倒|头晕|摔倒|出血|不舒服|误服|多吃了)/.test(normalized)) return null;
  if (!LOCATION_INTENT.test(normalized)) return null;

  const medicine = normalized.match(MEDICINE_TERMS)?.[1];
  if (medicine) {
    return { name: 'home.find_item', input: { query: medicine === '药' ? '常用药' : medicine } };
  }
  if (/(老花镜|眼镜)/.test(normalized)) {
    return { name: 'home.find_item', input: { query: normalized.includes('老花镜') ? '老花镜' : '眼镜' } };
  }
  if (/钥匙/.test(normalized)) return { name: 'home.find_item', input: { query: '钥匙' } };
  const item = normalized.match(/(?:找不到|帮我找一下|帮我找|寻找)(.+?)[。？！!?]*$/)?.[1]?.trim();
  if (item) return { name: 'home.find_item', input: { query: item } };
  return null;
}
