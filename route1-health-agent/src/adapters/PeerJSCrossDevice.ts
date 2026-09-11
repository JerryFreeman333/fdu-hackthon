/**
 * PeerJS 跨设备协同适配器。
 *
 * 数据流走 WebRTC DataChannel，不经过任何中转服务器（除了 PeerJS 公开信令服务器
 * 仅用于初次握手 NAT/SDP 协商）。老人端用邀请码作为 peer ID 起一个 peer，
 * 家属端输入邀请码后连接进来；握手成功后两端可以互相发 JSON。
 *
 * 这是真跨设备协同——两台真手机只要都能访问 PeerJS 公开信令，
 * 就能像同浏览器两 tab 一样实时同步派发台账与确认动作。
 *
 * 公开信令依赖意味着：PeerJS 公开服务器宕机或被墙时会回退到本地协同模式，
 * UI 必须明示当前是哪一种，不能把"联不通"包装成"已协同"。
 */
import Peer, { type DataConnection } from 'peerjs';

export type PeerMode = 'idle' | 'opening' | 'waiting' | 'connecting' | 'connected' | 'failed' | 'closed';

export interface PeerStatus {
  mode: PeerMode;
  peerId: string | null;
  detail?: string;
}

type PeerMessage = unknown;

export interface HostHandle {
  peerId: string;
  destroy(): void;
  onMessage(handler: (message: PeerMessage) => void): void;
  onStatus(handler: (status: PeerStatus) => void): void;
  broadcast(message: PeerMessage): void;
}

export interface GuestHandle {
  destroy(): void;
  onMessage(handler: (message: PeerMessage) => void): void;
  onStatus(handler: (status: PeerStatus) => void): void;
}

const DEFAULT_OPEN_TIMEOUT_MS = 8000;
const DEFAULT_CONNECT_TIMEOUT_MS = 10000;

function isPeerMessage(value: unknown): value is PeerMessage {
  return value === null || typeof value === 'object';
}

function emitTo(handlers: Array<(s: PeerStatus) => void>, status: PeerStatus) {
  for (const handler of handlers) handler(status);
}

/**
 * 老人端：以 inviteCode 作为 peer ID 起一个 peer，等待家属端连进来。
 * 信令失败 / 超时会上报 status.mode='failed'，由 UI 决定是否回退到 BroadcastChannel。
 */
export function hostAsPeer(inviteCode: string, openTimeoutMs = DEFAULT_OPEN_TIMEOUT_MS): Promise<HostHandle> {
  return new Promise((resolve, reject) => {
    let peer: Peer | null = null;
    const messageHandlers: Array<(message: PeerMessage) => void> = [];
    const statusHandlers: Array<(status: PeerStatus) => void> = [];
    const connections = new Set<DataConnection>();
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        peer?.destroy();
      } catch {}
      reject(new Error('peerjs open timeout after ' + openTimeoutMs + 'ms'));
    }, openTimeoutMs);

    try {
      peer = new Peer(inviteCode);
    } catch (error) {
      window.clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    peer.on('open', (id) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      const waitingStatus: PeerStatus = { mode: 'waiting', peerId: id, detail: '等待家属端连接' };
      emitTo(statusHandlers, waitingStatus);
      resolve({
        peerId: id,
        onMessage(handler) {
          messageHandlers.push(handler);
        },
        onStatus(handler) {
          statusHandlers.push(handler);
          handler(waitingStatus);
        },
        destroy() {
          for (const conn of connections) {
            try {
              conn.close();
            } catch {}
          }
          connections.clear();
          try {
            peer?.destroy();
          } catch {}
          emitTo(statusHandlers, { mode: 'closed', peerId: id, detail: '已关闭' });
        },
        broadcast(message) {
          if (!isPeerMessage(message)) return;
          for (const conn of connections) {
            if (conn.open) {
              try {
                conn.send(message);
              } catch {}
            }
          }
        },
      });
    });

    peer.on('connection', (conn) => {
      connections.add(conn);
      conn.on('open', () => {
        emitTo(statusHandlers, { mode: 'connected', peerId: inviteCode, detail: '家属端已连入' });
      });
      conn.on('data', (data) => {
        if (!isPeerMessage(data)) return;
        for (const handler of messageHandlers) handler(data);
      });
      conn.on('close', () => {
        connections.delete(conn);
        emitTo(statusHandlers, { mode: 'waiting', peerId: inviteCode, detail: '家属端已断开' });
      });
      conn.on('error', (err) => {
        emitTo(statusHandlers, { mode: 'failed', peerId: inviteCode, detail: err.message });
      });
    });

    peer.on('error', (err) => {
      if (settled) {
        emitTo(statusHandlers, { mode: 'failed', peerId: inviteCode, detail: err.message });
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      const detail = (err as { type?: string }).type ?? (err instanceof Error ? err.message : 'peerjs error');
      reject(err instanceof Error ? err : new Error(detail));
    });

    peer.on('disconnected', () => {
      emitTo(statusHandlers, { mode: 'failed', peerId: inviteCode, detail: '与信令服务器断开' });
    });
  });
}

/**
 * 家属端：用 inviteCode 作为目标 peer ID 主动连接。超时会 reject，
 * 让上层决定是否回退到本地协同模式。
 */
export function connectToPeer(inviteCode: string, connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS): Promise<GuestHandle> {
  return new Promise((resolve, reject) => {
    let peer: Peer | null = null;
    const messageHandlers: Array<(message: PeerMessage) => void> = [];
    const statusHandlers: Array<(status: PeerStatus) => void> = [];
    let conn: DataConnection | null = null;
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        conn?.close();
        peer?.destroy();
      } catch {}
      reject(new Error('peerjs connect timeout after ' + connectTimeoutMs + 'ms'));
    }, connectTimeoutMs);

    try {
      peer = new Peer();
    } catch (error) {
      window.clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    peer.on('open', () => {
      conn = peer!.connect(inviteCode, { reliable: true });
      conn.on('open', () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        const connectedStatus: PeerStatus = { mode: 'connected', peerId: inviteCode, detail: '已连上老人端' };
        emitTo(statusHandlers, connectedStatus);
        resolve({
          onMessage(handler) {
            messageHandlers.push(handler);
          },
          onStatus(handler) {
            statusHandlers.push(handler);
            handler(connectedStatus);
          },
          destroy() {
            try {
              conn?.close();
            } catch {}
            try {
              peer?.destroy();
            } catch {}
            emitTo(statusHandlers, { mode: 'closed', peerId: inviteCode, detail: '已关闭' });
          },
        });
      });
      conn.on('data', (data) => {
        if (!isPeerMessage(data)) return;
        for (const handler of messageHandlers) handler(data);
      });
      conn.on('close', () => {
        emitTo(statusHandlers, { mode: 'closed', peerId: inviteCode, detail: '连接已关闭' });
      });
      conn.on('error', (err) => {
        emitTo(statusHandlers, { mode: 'failed', peerId: inviteCode, detail: err.message });
      });
    });

    peer.on('error', (err) => {
      if (settled) {
        emitTo(statusHandlers, { mode: 'failed', peerId: inviteCode, detail: err.message });
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      const detail = (err as { type?: string }).type ?? (err instanceof Error ? err.message : 'peerjs error');
      reject(err instanceof Error ? err : new Error(detail));
    });
  });
}
