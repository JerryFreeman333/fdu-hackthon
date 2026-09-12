/**
 * 跨设备 + 同浏览器协同的统一通道。
 *
 * - 同浏览器 tab/window 之间：BroadcastChannel，无需网络，零延迟
 * - 真跨设备（两台真手机 / 一台手机一台电脑）：PeerJS + WebRTC DataChannel
 *   老人端用邀请码作为 peer ID 起 peer；家属端输入邀请码后连进去。
 *   数据走 P2P，不经过任何中转服务器（PeerJS 公开服务器只做 NAT/SDP 信令握手）
 * - PeerJS 公开信令不可用时（无网络 / 服务器宕机）回退到 BroadcastChannel，
 *   UI 必须如实标注当前模式，不能把"联不通"包装成"已协同"
 *
 * 协议与之前 useCrossTabSync 完全一致（dispatch.append / dispatch.acknowledge / family.link），
 * 让 useNotificationDispatch 不需要关心通道类型。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UserRole } from '../types';
import {
  hostAsPeer,
  connectToPeer,
  type PeerStatus,
  type HostHandle,
  type GuestHandle,
} from '../adapters/PeerJSCrossDevice';
import { runWithRetry } from '../engine/retry';
import type { CrossTabMessageEnvelope } from './useCrossTabSync';

export type SyncMode = 'local-only' | 'connecting' | 'cross-device' | 'failed';

export interface CrossDeviceStatus {
  mode: SyncMode;
  detail: string;
  peerId: string | null;
}

type Handler = (envelope: CrossTabMessageEnvelope) => void;

const CHANNEL_NAME = 'ankang-route1-cross-tab';
const TAB_ID_KEY = 'ankang-route1-tab-id';
const PING_INTERVAL_MS = 15000;
/** 家属端首连重试（评审 P2）：公网信令抖动时再试，而不是一次失败就放弃。 */
const GUEST_CONNECT_ATTEMPTS = 3;
const GUEST_CONNECT_RETRY_DELAY_MS = 1500;

function ensureTabId(): string {
  if (typeof window === 'undefined') return 'ssr';
  try {
    const existing = window.sessionStorage.getItem(TAB_ID_KEY);
    if (existing) return existing;
    const generated = 'tab-' + Math.random().toString(36).slice(2, 10);
    window.sessionStorage.setItem(TAB_ID_KEY, generated);
    return generated;
  } catch {
    return 'tab-fallback-' + Math.random().toString(36).slice(2, 10);
  }
}

export type CrossTabMessage = CrossTabMessageEnvelope;

interface UseCrossDeviceSyncOptions {
  role: UserRole | null;
  /**
   * 老人端：把当前邀请码作为 peer ID 开放 peer，等待家属端连入
   * 家属端：把当前邀请码作为目标 peer ID 主动连入
   * 不传则只走 BroadcastChannel（同浏览器 tab 协同）
   */
  peerId?: string | null;
  /** 角色端标识，决定 elder 起 peer 还是 family 连 peer；同值则跳过 PeerJS */
  endpoint: 'host' | 'guest' | 'none';
}

export function useCrossDeviceSync({ role, peerId, endpoint }: UseCrossDeviceSyncOptions): {
  broadcast: (type: CrossTabMessageEnvelope['type'], payload: unknown) => void;
  /** 只在本浏览器的 tab 之间广播（不进 PeerJS）：健康事件与 IndexedDB 同一信任域，不落到别的设备。 */
  broadcastLocal: (type: CrossTabMessageEnvelope['type'], payload: unknown) => void;
  subscribe: (handler: Handler) => () => void;
  status: CrossDeviceStatus;
  tabId: string;
} {
  const tabIdRef = useRef<string>(ensureTabId());
  const channelRef = useRef<BroadcastChannel | null>(null);
  const handlersRef = useRef<Set<Handler>>(new Set());
  const peerHandleRef = useRef<HostHandle | GuestHandle | null>(null);
  const lastBroadcastSignatureRef = useRef<string>('');
  const [status, setStatus] = useState<CrossDeviceStatus>({
    mode: 'local-only',
    detail: '仅本地同浏览器协同',
    peerId: null,
  });

  // BroadcastChannel: 始终挂载
  useEffect(() => {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;
    const listener = (event: MessageEvent<CrossTabMessageEnvelope>) => {
      const envelope = event.data;
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

  // PeerJS: 仅在有 peerId 且 endpoint 不为 none 时挂载
  useEffect(() => {
    if (!peerId || endpoint === 'none' || typeof window === 'undefined') return;
    let cancelled = false;
    setStatus({ mode: 'connecting', detail: '正在建立跨设备连接…', peerId });

    const handleMessage = (raw: unknown) => {
      const envelope = raw as CrossTabMessageEnvelope;
      if (!envelope || envelope.tabId === tabIdRef.current) return;
      for (const handler of handlersRef.current) handler(envelope);
    };

    const wireUp = async () => {
      try {
        // 家属端首连带重试（评审 P2）：信令抖动 / 老人端 peer 还没注册完成时再试，
        // 每次重试都在状态里如实显示，重试耗尽才进入 failed。
        const handle =
          endpoint === 'host'
            ? await hostAsPeer(peerId)
            : await runWithRetry((_attempt) => connectToPeer(peerId), {
                attempts: GUEST_CONNECT_ATTEMPTS,
                delayMs: GUEST_CONNECT_RETRY_DELAY_MS,
                onRetry: (failedAttempt, error) => {
                  if (cancelled) return;
                  setStatus({
                    mode: 'connecting',
                    detail: `暂时没连上，正在再试（第 ${failedAttempt + 1}/${GUEST_CONNECT_ATTEMPTS} 次）：${error.message}`,
                    peerId,
                  });
                },
              });
        if (cancelled) {
          handle.destroy();
          return;
        }
        peerHandleRef.current = handle;
        handle.onMessage((msg) => handleMessage(msg));
        const reflectStatus = (peerStatus: PeerStatus) => {
          if (cancelled) return;
          if (peerStatus.mode === 'connected') {
            setStatus({ mode: 'cross-device', detail: peerStatus.detail ?? '跨设备实时协同', peerId });
          } else if (peerStatus.mode === 'failed' || peerStatus.mode === 'closed') {
            setStatus({ mode: 'failed', detail: peerStatus.detail ?? '跨设备连接中断', peerId });
          } else {
            setStatus({ mode: 'connecting', detail: peerStatus.detail ?? '正在建立连接…', peerId });
          }
        };
        handle.onStatus(reflectStatus);
      } catch (error) {
        if (cancelled) return;
        setStatus({
          mode: 'failed',
          detail: error instanceof Error ? error.message : '跨设备连接失败',
          peerId,
        });
      }
    };
    void wireUp();

    // 周期 ping: 探测对端是否还活着
    const pingTimer = window.setInterval(() => {
      if (cancelled) return;
      const handle = peerHandleRef.current as HostHandle | GuestHandle | null;
      if (handle && 'broadcast' in handle) {
        try {
          handle.broadcast({
            tabId: tabIdRef.current,
            fromRole: role,
            type: 'ping',
            payload: null,
            at: new Date().toISOString(),
          });
        } catch {}
      }
    }, PING_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(pingTimer);
      try {
        peerHandleRef.current?.destroy();
      } catch {}
      peerHandleRef.current = null;
    };
  }, [peerId, endpoint, role]);

  const broadcast = useCallback(
    (type: CrossTabMessageEnvelope['type'], payload: unknown) => {
      const envelope: CrossTabMessageEnvelope = {
        tabId: tabIdRef.current,
        fromRole: role,
        type,
        payload,
        at: new Date().toISOString(),
      };
      const signature = JSON.stringify({ type, payload });
      if (signature === lastBroadcastSignatureRef.current) return;
      lastBroadcastSignatureRef.current = signature;

      // 同浏览器 tab
      const channel = channelRef.current;
      if (channel) {
        try {
          channel.postMessage(envelope);
        } catch {}
      }
      // 跨设备 P2P
      const handle = peerHandleRef.current as HostHandle | GuestHandle | null;
      if (handle && 'broadcast' in handle) {
        try {
          handle.broadcast(envelope);
        } catch {}
      }
    },
    [role],
  );

  const broadcastLocal = useCallback(
    (type: CrossTabMessageEnvelope['type'], payload: unknown) => {
      const envelope: CrossTabMessageEnvelope = {
        tabId: tabIdRef.current,
        fromRole: role,
        type,
        payload,
        at: new Date().toISOString(),
      };
      const channel = channelRef.current;
      if (!channel) return;
      try {
        channel.postMessage(envelope);
      } catch {}
    },
    [role],
  );

  const subscribe = useCallback((handler: Handler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  return { broadcast, broadcastLocal, subscribe, status, tabId: tabIdRef.current };
}
