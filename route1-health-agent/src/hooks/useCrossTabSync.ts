import { useCallback, useEffect, useRef } from 'react';
import type { UserRole } from '../types';

/**
 * Demo 阶段跨 tab 协同：基于 BroadcastChannel 把同一浏览器里打开的多个 tab/window
 * 串成"两个角色互相能看见"的双向通道。这是真跨设备同步上线前最诚实的演示形态——
 * 至少能让"老人端"和"家属端"在同浏览器的两个 tab 里实时互相感知，而不只是
 * 切同一个 useState。它不能替代后端账号体系 / WebSocket / BaaS，但能让协同路径
 * 在本机上跑通，从而把"切角色不等于真协同"这一暴露面补上一块。
 *
 * 协议（轻量 JSON，自描述）：
 * - dispatch.acknowledge  { findingId }
 * - dispatch.append       { record }
 * - family.link           { link, sharing }
 * - chat.append           { message }
 * - chat.share            { sharedFindingIds, sharedFamilyEventIds }
 *
 * 设计原则：
 * - 同 tab 不接收自己的广播（用 sessionStorage 生成的 tabId 过滤）；
 * - 接收端只做追加/合并，不重派发（防回环）；
 * - BroadcastChannel 在不支持的环境（SSR / 老浏览器）静默降级为 no-op，
 *   不破坏现有 useState 主路径。
 */

export type CrossTabMessage =
  | { type: 'dispatch.acknowledge'; findingId: string }
  | { type: 'dispatch.append'; record: unknown }
  | { type: 'family.link'; link: unknown; sharing: UserRole | null }
  | { type: 'chat.append'; message: unknown }
  | { type: 'chat.share'; sharedFindingIds: string[]; sharedFamilyEventIds: string[] };

export interface CrossTabMessageEnvelope {
  tabId: string;
  fromRole: UserRole | null;
  type: CrossTabMessage['type'];
  payload: unknown;
  at: string;
}

type Handler = (envelope: CrossTabMessageEnvelope) => void;

const CHANNEL_NAME = 'ankang-route1-cross-tab';
const TAB_ID_KEY = 'ankang-route1-tab-id';

function ensureTabId(): string {
  if (typeof window === 'undefined') return 'ssr';
  try {
    const existing = window.sessionStorage.getItem(TAB_ID_KEY);
    if (existing) return existing;
    const generated = `tab-${Math.random().toString(36).slice(2, 10)}`;
    window.sessionStorage.setItem(TAB_ID_KEY, generated);
    return generated;
  } catch {
    return `tab-fallback-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function useCrossTabSync(role: UserRole | null): {
  broadcast: (type: CrossTabMessage['type'], payload: unknown) => void;
  subscribe: (handler: Handler) => () => void;
  isSupported: boolean;
  tabId: string;
} {
  const tabIdRef = useRef<string>(ensureTabId());
  const channelRef = useRef<BroadcastChannel | null>(null);
  const handlersRef = useRef<Set<Handler>>(new Set());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;
    const listener = (event: MessageEvent<CrossTabMessageEnvelope>) => {
      const envelope = event.data;
      // 忽略自己广播的回声（理论上 BroadcastChannel 不会回声，但防御性写一份）
      if (!envelope || envelope.tabId === tabIdRef.current) return;
      for (const handler of handlersRef.current) handler(envelope);
    };
    channel.addEventListener('message', listener);
    return () => {
      channel.removeEventListener('message', listener);
      channel.close();
      channelRef.current = null;
    };
  }, []);

  const broadcast = useCallback(
    (type: CrossTabMessage['type'], payload: unknown) => {
      const channel = channelRef.current;
      if (!channel) return;
      const envelope: CrossTabMessageEnvelope = {
        tabId: tabIdRef.current,
        fromRole: role,
        type,
        payload,
        at: new Date().toISOString(),
      };
      channel.postMessage(envelope);
    },
    [role],
  );

  const subscribe = useCallback((handler: Handler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  return {
    broadcast,
    subscribe,
    isSupported: typeof BroadcastChannel !== 'undefined',
    tabId: tabIdRef.current,
  };
}
