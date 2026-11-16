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
 * - family.consent        { sharing, updatedAt }（老人端授权的唯一权威广播）
 * - family.share          { sharedFindingIds, sharedFamilyEventIds }（老人端一次性共享清单）
 * - history.share         { views: SharedHistoricalFact[] }（老人端脱敏后的既往事实派生视图）
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
  | { type: 'medication.update'; payload: unknown }
  | { type: 'dispatch.acknowledge'; findingId: string }
  | { type: 'dispatch.append'; record: unknown }
  | { type: 'family.link'; link: unknown; sharing: UserRole | null }
  | { type: 'chat.append'; message: unknown }
  | { type: 'chat.share'; sharedFindingIds: string[]; sharedFamilyEventIds: string[] }
  /**
   * 家人事实账本中"已授权可见"的那一部分（不是原始事件）。
   * 老人端在本地先跑 visibleFamilyEvents，再广播结果；private 与未授权事件
   * 永远不离开老人设备。家属端只做镜像合并，用于展示家人安全卡片与近况记录。
   * payload: { events: FamilyHealthEvent[] }
   */
  | { type: 'family.events.append'; events: unknown[] }
  /**
   * P0-1 配套：健康事件在**同浏览器**各 tab 间保持一致（与 IndexedDB 持久化同一信任域，
   * 只走 BroadcastChannel，不进 PeerJS——私密事件不能落到另一台设备的存储里）。
   * payload: { events: HealthEvent[] }
   */
  | { type: 'events.append'; events: unknown[] }
  /**
   * P0-1 配套：隐私安全的"今日信号量"摘要（只有数量，没有内容），同浏览器与
   * 跨设备（PeerJS）都发——让另一台设备上的家属端也能如实显示
   * "有 N 条信号被隐私挡住"，而不是"今天还没有任何健康信号"。
   * payload: { today: string; signalCount: number; gatedAlertCount: number }
   */
  | { type: 'signals.summary'; today: string; signalCount: number; gatedAlertCount: number }
  /**
   * 评审 P0-1 修复：老人端的共享授权是全系统唯一的权威状态。授权变化必须广播到
   * 同浏览器其它 tab 与跨设备（PeerJS）家属端，否则家属端自己的 familySharing
   * 恒为 'denied'，collectFamilyNotifications 永远算出空数组——家属端永远收不到通知。
   * 载荷只有授权位与时间戳，没有任何健康内容，走 PeerJS 也安全。
   * payload: { sharing: 'denied' | 'granted'; updatedAt: string }
   */
  | { type: 'family.consent'; sharing: 'denied' | 'granted'; updatedAt: string }
  /**
   * 老人端的一次性共享清单。家属端必须拿到同一组 ID，否则它会在自己的
   * visibleFamilyEvents / collectFamilyNotifications 里把 one_time 内容再过滤掉。
   * 载荷只有 ID，没有正文；只向已完成握手的家属端发送。
   * payload: { sharedFindingIds: string[]; sharedFamilyEventIds: string[] }
   */
  | { type: 'family.share'; sharedFindingIds?: string[]; sharedFamilyEventIds?: string[] }
  /**
   * 既往事实的脱敏派生视图。原始 HistoricalHealthEvent 不跨端；载荷校验失败
   * 或授权撤回时，家属端应替换为空数组并删除本地持久化。
   * payload: { views: SharedHistoricalFact[] }
   */
  | { type: 'history.share'; familyLinkId: string; views?: unknown[] }
  | { type: 'history.request'; familyLinkId: string; requestId: string }
  /**
   * 家属端只能“请求”老人暂停共享，不能单方面改写老人端的授权。
   * 老人端收到后调用 revokeFamilyShare()，再由 family.consent 广播权威结果。
   * payload: { requestId: string }
   */
  | { type: 'family.consent.request'; requestId: string };

export interface CrossTabMessageEnvelope {
  tabId: string;
  fromRole: UserRole | null;
  type: CrossTabMessage['type'];
  payload: unknown;
  at: string;
  /**
   * P1（评审安全项）：消息来自哪条通道。BroadcastChannel 与本浏览器 IndexedDB
   * 同一信任域；PeerJS 对端在绑定握手完成前是"陌生人"。接收端据此执行门控：
   * 陌生人发来的确认/台账消息一律忽略。
   */
  via?: 'local' | 'peer';
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
