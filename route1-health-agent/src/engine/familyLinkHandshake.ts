/**
 * 家属绑定握手编排（P0-2 改进方案，见 docs/route1-p0-2-family-binding-plan.md）。
 *
 * 绑定 = 一次以邀请码为共享密钥的握手：家属端出示邀请码，拥有邀请码的老人端
 * 校验并应答。校验发生在老人端，而不是输入方的本地内存——这是修复
 * "issuedInviteCode 只存在于生成邀请码那个 tab 的 React 内存里"死局的关键。
 *
 * 三层递进，任何一层成功即绑定成功：
 * L1 本地比对（调用方处理，不在本模块）
 * L2 BroadcastChannel：同浏览器两个 tab（1.5s 窗口）
 * L3 PeerJS DataChannel：两台真设备（拨号 + 应答各 10s 上限）
 *
 * 全部失败时按原因归类返回，绝不伪装成功（延续"诚实失败"原则）。
 * 本模块是纯编排：通道实现（broadcast/subscribe/dialPeer）全部注入，可单测。
 */

export interface FamilyLinkPayload {
  id: string;
  relation: string;
  displayName: string;
  maskedContact: string;
  inviteCode: string;
  status: 'active' | 'pending';
}

export interface FamilyLinkMessage {
  kind: 'request' | 'accepted' | 'rejected';
  requestId: string;
  /** request 携带：家属输入的邀请码 */
  code?: string;
  /** rejected 时携带：code_mismatch（码不对/已失效）| not_elder（当前端不是老人端） */
  reason?: 'code_mismatch' | 'not_elder';
  /** accepted 时携带：老人端生成的绑定关系 */
  link?: FamilyLinkPayload;
}

/** 通道抽象：与 useCrossTabSync / useCrossDeviceSync 的能力同构，避免类型耦合。 */
export interface LinkHandshakeTransport {
  broadcast: (type: string, payload: unknown) => void;
  subscribe: (handler: (envelope: { type: string; payload: unknown }) => void) => () => void;
}

/** L3 的一次性拨号连接：拨通后可发可收，用完必须 close。 */
export interface LinkPeerConnection {
  send: (message: unknown) => void;
  onMessage: (handler: (message: unknown) => void) => void;
  close: () => void;
}

export type LinkPeerDialer = (code: string) => Promise<LinkPeerConnection>;

export type LinkHandshakeResult =
  | { ok: true; link: FamilyLinkPayload }
  | { ok: false; reason: 'rejected' | 'unreachable'; detail?: string };

export interface LinkHandshakeOptions extends LinkHandshakeTransport {
  code: string;
  dialPeer?: LinkPeerDialer;
  /** L2 应答窗口（同浏览器跨 tab），默认 1500ms */
  broadcastTimeoutMs?: number;
  /** L3 应答窗口（跨设备），默认 10000ms */
  peerTimeoutMs?: number;
}

const DEFAULT_BROADCAST_TIMEOUT_MS = 1500;
const DEFAULT_PEER_TIMEOUT_MS = 10000;
export const FAMILY_LINK_MESSAGE_TYPE = 'family.link';

export function createLinkRequestId(): string {
  const random =
    typeof crypto !== 'undefined' && 'getRandomValues' in crypto
      ? crypto.getRandomValues(new Uint32Array(1))[0].toString(36)
      : Math.random().toString(36).slice(2);
  return `link-${Date.now().toString(36)}-${random}`;
}

function isValidLink(value: unknown): value is FamilyLinkPayload {
  if (typeof value !== 'object' || value === null) return false;
  const link = value as Partial<FamilyLinkPayload>;
  return (
    typeof link.id === 'string' &&
    typeof link.inviteCode === 'string' &&
    (link.status === 'active' || link.status === 'pending') &&
    typeof link.displayName === 'string'
  );
}

/** 从任意 envelope 里抠出"属于本次握手"的应答；不匹配/非法一律返回 null。 */
export function matchLinkReply(
  envelope: unknown,
  requestId: string,
): { kind: 'accepted'; link: FamilyLinkPayload } | { kind: 'rejected'; reason?: string } | null {
  if (typeof envelope !== 'object' || envelope === null) return null;
  const record = envelope as { type?: unknown; payload?: unknown };
  if (record.type !== FAMILY_LINK_MESSAGE_TYPE) return null;
  if (typeof record.payload !== 'object' || record.payload === null) return null;
  const payload = record.payload as Partial<FamilyLinkMessage>;
  if (payload.requestId !== requestId) return null;
  if (payload.kind === 'accepted' && isValidLink(payload.link)) return { kind: 'accepted', link: payload.link };
  if (payload.kind === 'rejected') return { kind: 'rejected', reason: payload.reason };
  return null;
}

/** L2：同浏览器跨 tab。先订阅再广播，窗口内等 accepted / rejected。 */
async function handshakeOverBroadcast(
  options: LinkHandshakeOptions,
  requestId: string,
): Promise<{ done: boolean; result?: LinkHandshakeResult }> {
  const timeoutMs = options.broadcastTimeoutMs ?? DEFAULT_BROADCAST_TIMEOUT_MS;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result?: LinkHandshakeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve({ done: result !== undefined, result });
    };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    const unsubscribe = options.subscribe((envelope) => {
      const reply = matchLinkReply(envelope, requestId);
      if (!reply) return;
      if (reply.kind === 'accepted') finish({ ok: true, link: reply.link });
      else finish({ ok: false, reason: 'rejected', detail: reply.reason ?? 'code_mismatch' });
    });
    options.broadcast(FAMILY_LINK_MESSAGE_TYPE, {
      kind: 'request',
      requestId,
      code: options.code,
    } satisfies FamilyLinkMessage);
  });
}

/** L3：跨设备。临时拨号到老人端，把 request 直接写进 DataChannel，等应答后断开。 */
async function handshakeOverPeer(options: LinkHandshakeOptions, requestId: string): Promise<LinkHandshakeResult> {
  if (!options.dialPeer) return { ok: false, reason: 'unreachable', detail: 'no_peer_transport' };
  const timeoutMs = options.peerTimeoutMs ?? DEFAULT_PEER_TIMEOUT_MS;
  let connection: LinkPeerConnection | null = null;
  try {
    connection = await options.dialPeer(options.code);
  } catch (error) {
    return {
      ok: false,
      reason: 'unreachable',
      detail: error instanceof Error ? error.message : 'peer_dial_failed',
    };
  }
  return new Promise<LinkHandshakeResult>((resolve) => {
    let settled = false;
    const finish = (result: LinkHandshakeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        connection?.close();
      } catch {}
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ ok: false, reason: 'unreachable', detail: 'peer_reply_timeout' }),
      timeoutMs,
    );
    connection.onMessage((message) => {
      const reply = matchLinkReply(message, requestId);
      if (!reply) return;
      if (reply.kind === 'accepted') finish({ ok: true, link: reply.link });
      else finish({ ok: false, reason: 'rejected', detail: reply.reason ?? 'code_mismatch' });
    });
    connection.send({
      type: FAMILY_LINK_MESSAGE_TYPE,
      payload: { kind: 'request', requestId, code: options.code } satisfies FamilyLinkMessage,
    });
  });
}

/**
 * 家属端绑定入口：L2 → L3 顺序尝试。
 * L2 超时不算失败（同浏览器外没人应答是正常情况），只有 L3 也失败才返回失败。
 */
export async function performLinkHandshake(options: LinkHandshakeOptions): Promise<LinkHandshakeResult> {
  const requestId = createLinkRequestId();
  const broadcastOutcome = await handshakeOverBroadcast(options, requestId);
  if (broadcastOutcome.done && broadcastOutcome.result) return broadcastOutcome.result;
  return handshakeOverPeer(options, requestId);
}
