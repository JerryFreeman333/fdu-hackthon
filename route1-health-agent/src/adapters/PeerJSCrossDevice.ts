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
import type Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import { appConfig } from '../config/appConfig';

/** 只声明本适配器实际用到的 PeerJS 选项，避免与版本类型耦合。 */
interface PeerClientOptions {
  host?: string;
  port?: number;
  path?: string;
  secure?: boolean;
  config?: { iceServers?: RTCIceServer[] };
}

type PeerConstructor = new (...args: [id: string, options?: PeerClientOptions] | [options?: PeerClientOptions]) => Peer;

/**
 * peerjs 体积较大且只在跨设备协同真正启用时才需要，改为动态加载，
 * 避免老人端首屏为它付出下载成本（审查反馈：目标用户是弱网旧手机）。
 */
let peerCtorPromise: Promise<PeerConstructor> | null = null;
function loadPeerConstructor(): Promise<PeerConstructor> {
  if (!peerCtorPromise) {
    peerCtorPromise = import('peerjs').then((module) => module.default);
  }
  return peerCtorPromise;
}

/**
 * 信令与 ICE 选项（P2：环境读取收敛到 appConfig）：
 * - 配置了 VITE_PEER_SIGNALING_URL → 指向自建/国内可达信令（大陆网络风险缓解）；
 * - VITE_PEER_ICE_SERVERS → 完全自定义 ICE（如加 TURN）；
 * - 默认 Google + 腾讯公共 STUN 并列，任一可达即可。
 */
function peerOptions(): PeerClientOptions | null {
  const { signalingRaw, signaling, iceServers } = appConfig.peer;
  if (signalingRaw && !signaling) {
    console.warn('[peerjs] VITE_PEER_SIGNALING_URL 无法解析，回退官方公共信令');
  }
  const options: PeerClientOptions = { config: { iceServers } };
  if (signaling) {
    options.host = signaling.host;
    options.port = signaling.port;
    options.path = signaling.path;
    options.secure = signaling.secure;
  }
  return options;
}

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
  /** 家属端同样需要发送（绑定握手 request、派发确认动作都走这条路）。 */
  broadcast(message: PeerMessage): void;
}

const DEFAULT_OPEN_TIMEOUT_MS = 8000;
const DEFAULT_CONNECT_TIMEOUT_MS = 10000;

/**
 * 邀请码 → peer id 的唯一推导（P0-2）。
 * 裸邀请码直接当 peer id 会与全球其它 PeerJS 应用相撞（"unavailable id"），
 * 加命名空间前缀后：老人端 host、家属端 guest、绑定握手临时拨号三处
 * 必须使用同一个推导，否则永远连不上。
 */
export function peerIdForInviteCode(inviteCode: string): string {
  return `ankang-r1-${inviteCode.trim()}`;
}

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
export async function hostAsPeer(inviteCode: string, openTimeoutMs = DEFAULT_OPEN_TIMEOUT_MS): Promise<HostHandle> {
  const PeerCtor = await loadPeerConstructor();
  const options = peerOptions();
  const peerId = peerIdForInviteCode(inviteCode);
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
      peer = options ? new PeerCtor(peerId, options) : new PeerCtor(peerId);
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
export async function connectToPeer(
  inviteCode: string,
  connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
): Promise<GuestHandle> {
  const PeerCtor = await loadPeerConstructor();
  const options = peerOptions();
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
      peer = options ? new PeerCtor(options) : new PeerCtor();
    } catch (error) {
      window.clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    peer.on('open', () => {
      conn = peer!.connect(peerIdForInviteCode(inviteCode), { reliable: true });
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
          broadcast(message) {
            if (!isPeerMessage(message)) return;
            if (conn && conn.open) {
              try {
                conn.send(message);
              } catch {}
            }
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
