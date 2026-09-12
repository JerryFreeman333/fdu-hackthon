/**
 * 家属绑定握手编排（P0-2）单测。
 * 通道全部注入假实现，验证：L2 成功 / rejected 传播 / L2 超时回落 L3 /
 * L3 成功 / L3 失败归因 / requestId 不匹配忽略 / 非法 link 丢弃。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FAMILY_LINK_MESSAGE_TYPE,
  createLinkRequestId,
  matchLinkReply,
  performLinkHandshake,
  type FamilyLinkPayload,
  type LinkHandshakeTransport,
  type LinkPeerConnection,
} from '../src/engine/familyLinkHandshake';

const CODE = 'AN-2026-K7QXW2RN9M';
const LINK: FamilyLinkPayload = {
  id: 'family-1',
  relation: '家属',
  displayName: '已通过邀请码绑定的家属',
  maskedContact: '已验证邀请码',
  inviteCode: CODE,
  status: 'active',
};

interface FakeBus extends LinkHandshakeTransport {
  sent: Array<{ type: string; payload: unknown }>;
  deliver(envelope: unknown): void;
  handlerCount(): number;
}

function fakeBus(): FakeBus {
  const handlers = new Set<(envelope: { type: string; payload: unknown }) => void>();
  const bus: FakeBus = {
    sent: [],
    broadcast(type: string, payload: unknown) {
      bus.sent.push({ type, payload });
    },
    subscribe(handler: (envelope: { type: string; payload: unknown }) => void) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    deliver(envelope: unknown) {
      for (const handler of [...handlers]) handler(envelope as { type: string; payload: unknown });
    },
    handlerCount() {
      return handlers.size;
    },
  };
  return bus;
}

interface FakePeerConn extends LinkPeerConnection {
  sent: unknown[];
  closed?: boolean;
  emit(message: unknown): void;
}

function fakeDial(respond?: (request: unknown, conn: FakePeerConn) => void, delayMs = 0) {
  const conns: FakePeerConn[] = [];
  const dial = async (): Promise<LinkPeerConnection> => {
    const handlers: Array<(message: unknown) => void> = [];
    const conn: FakePeerConn = {
      sent: [],
      send(message: unknown) {
        conn.sent.push(message);
        if (respond) windowSetTimeout(() => respond(message, conn), delayMs);
      },
      onMessage(handler: (message: unknown) => void) {
        handlers.push(handler);
      },
      close() {
        conn.closed = true;
      },
      emit(message: unknown) {
        for (const handler of [...handlers]) handler(message);
      },
    };
    conns.push(conn);
    return conn;
  };
  return { dial, conns };
}

// Node 测试环境没有 window，补一个可直接用的 setTimeout 别名。
const windowSetTimeout = (fn: () => void, ms: number) => setTimeout(fn, ms);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void test('L2：同浏览器跨 tab——老人端应答 accepted 即绑定成功', async () => {
  const bus = fakeBus();
  const pending = performLinkHandshake({ code: CODE, broadcast: bus.broadcast, subscribe: bus.subscribe });
  // 请求已广播且带有邀请码
  assert.equal(bus.sent.length, 1);
  assert.equal(bus.sent[0]?.type, FAMILY_LINK_MESSAGE_TYPE);
  const request = bus.sent[0]?.payload as { kind: string; requestId: string; code: string };
  assert.equal(request.kind, 'request');
  assert.equal(request.code, CODE);

  bus.deliver({
    type: FAMILY_LINK_MESSAGE_TYPE,
    payload: { kind: 'accepted', requestId: request.requestId, link: LINK },
  });
  const result = await pending;
  assert.deepEqual(result, { ok: true, link: LINK });
  // 订阅在握手结束后必须释放
  assert.equal(bus.handlerCount(), 0);
});

void test('L2：老人端明确 rejected 时不得再回落 L3，必须如实报"码不对"', async () => {
  const bus = fakeBus();
  let dialed = 0;
  const pending = performLinkHandshake({
    code: CODE,
    broadcast: bus.broadcast,
    subscribe: bus.subscribe,
    dialPeer: async () => {
      dialed += 1;
      throw new Error('should not dial');
    },
  });
  const request = bus.sent[0]?.payload as { requestId: string };
  bus.deliver({
    type: FAMILY_LINK_MESSAGE_TYPE,
    payload: { kind: 'rejected', requestId: request.requestId, reason: 'code_mismatch' },
  });
  const result = await pending;
  assert.deepEqual(result, { ok: false, reason: 'rejected', detail: 'code_mismatch' });
  assert.equal(dialed, 0);
});

void test('L2 超时后回落 L3：跨设备拨号成功并拿到 accepted', async () => {
  const bus = fakeBus();
  const peer = fakeDial((request, conn) => {
    const wire = request as { payload?: { requestId?: string } };
    conn.emit({
      type: FAMILY_LINK_MESSAGE_TYPE,
      payload: { kind: 'accepted', requestId: wire.payload?.requestId, link: LINK },
    });
  });
  const pending = performLinkHandshake({
    code: CODE,
    broadcast: bus.broadcast,
    subscribe: bus.subscribe,
    dialPeer: peer.dial,
    broadcastTimeoutMs: 60,
    peerTimeoutMs: 2000,
  });
  const result = await pending;
  assert.deepEqual(result, { ok: true, link: LINK });
  // request 同时写进了 DataChannel
  assert.equal(peer.conns.length, 1);
  const wireRequest = peer.conns[0]?.sent[0] as { payload: { code: string } };
  assert.equal(wireRequest.payload.code, CODE);
});

void test('L3：信令不可达（拨号抛错）→ unreachable，原因如实透传', async () => {
  const bus = fakeBus();
  const result = await performLinkHandshake({
    code: CODE,
    broadcast: bus.broadcast,
    subscribe: bus.subscribe,
    dialPeer: async () => {
      throw new Error('peerjs connect timeout after 10000ms');
    },
    broadcastTimeoutMs: 30,
  });
  assert.deepEqual(result, { ok: false, reason: 'unreachable', detail: 'peerjs connect timeout after 10000ms' });
});

void test('L3：拨通了但对方不应答 → peer_reply_timeout', async () => {
  const bus = fakeBus();
  const peer = fakeDial(); // 拨通但永不回应
  const result = await performLinkHandshake({
    code: CODE,
    broadcast: bus.broadcast,
    subscribe: bus.subscribe,
    dialPeer: peer.dial,
    broadcastTimeoutMs: 30,
    peerTimeoutMs: 80,
  });
  assert.deepEqual(result, { ok: false, reason: 'unreachable', detail: 'peer_reply_timeout' });
});

void test('requestId 不匹配的应答一律忽略，直到窗口超时', async () => {
  const bus = fakeBus();
  const pending = performLinkHandshake({
    code: CODE,
    broadcast: bus.broadcast,
    subscribe: bus.subscribe,
    peerTimeoutMs: 0, // 没有 L3：无 dialPeer
    broadcastTimeoutMs: 80,
  });
  const request = bus.sent[0]?.payload as { requestId: string };
  // 乱入的旧应答 / 未知 requestId
  bus.deliver({ type: FAMILY_LINK_MESSAGE_TYPE, payload: { kind: 'accepted', requestId: 'link-stale', link: LINK } });
  bus.deliver({ type: 'other.message', payload: { kind: 'accepted', requestId: request.requestId, link: LINK } });
  const result = await pending;
  assert.deepEqual(result, { ok: false, reason: 'unreachable', detail: 'no_peer_transport' });
});

void test('link 载荷不合法时不得当作绑定成功', async () => {
  const bus = fakeBus();
  const pending = performLinkHandshake({
    code: CODE,
    broadcast: bus.broadcast,
    subscribe: bus.subscribe,
    broadcastTimeoutMs: 80,
  });
  const request = bus.sent[0]?.payload as { requestId: string };
  bus.deliver({
    type: FAMILY_LINK_MESSAGE_TYPE,
    payload: { kind: 'accepted', requestId: request.requestId, link: { id: 'x', inviteCode: CODE } },
  });
  const result = await pending;
  assert.equal(result.ok, false);
});

void test('matchLinkReply：非 family.link / 缺 requestId / 未知 kind 返回 null', () => {
  const requestId = createLinkRequestId();
  assert.equal(matchLinkReply({ type: 'dispatch.append', payload: {} }, requestId), null);
  assert.equal(matchLinkReply({ type: FAMILY_LINK_MESSAGE_TYPE, payload: { kind: 'accepted' } }, requestId), null);
  assert.equal(
    matchLinkReply({ type: FAMILY_LINK_MESSAGE_TYPE, payload: { kind: 'nonsense', requestId } }, requestId),
    null,
  );
  const good = matchLinkReply(
    { type: FAMILY_LINK_MESSAGE_TYPE, payload: { kind: 'accepted', requestId, link: LINK } },
    requestId,
  );
  assert.ok(good && good.kind === 'accepted');
});

void test('多次握手每次都带新的 requestId（去重签名不会吞掉第二次请求）', async () => {
  const bus = fakeBus();
  const run = () =>
    performLinkHandshake({ code: CODE, broadcast: bus.broadcast, subscribe: bus.subscribe, broadcastTimeoutMs: 20 });
  await run();
  await run();
  const first = bus.sent[0]?.payload as { requestId: string };
  const second = bus.sent[1]?.payload as { requestId: string };
  assert.notEqual(first.requestId, second.requestId);
});

void test('L2 超时本身不返回失败（等 L3 定论）', async () => {
  const bus = fakeBus();
  const result = await performLinkHandshake({
    code: CODE,
    broadcast: bus.broadcast,
    subscribe: bus.subscribe,
    dialPeer: async () => {
      throw new Error('offline');
    },
    broadcastTimeoutMs: 30,
  });
  // 最终失败原因必须来自 L3，而不是把 L2 超时当成"码不对"
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unreachable');
});

// ---------------------------------------------------------------------------
// P1（评审安全项）：邀请码熵。旧 4 位数字码（10^4）在公共信令上可被脚本
// 枚举拨号；新码 32 字符表 10 位（50bit），枚举不再可行。
// ---------------------------------------------------------------------------
import { createInviteCode } from '../src/hooks/useFamilyBinding';

const INVITE_CODE_PATTERN = /^AN-\d{4}-[A-Z2-9]{10}$/;

void test('邀请码格式：年段 + 10 位无歧义大写字符', () => {
  for (let i = 0; i < 50; i += 1) {
    const code = createInviteCode('2026-09-12');
    assert.match(code, INVITE_CODE_PATTERN, `格式不符：${code}`);
  }
});

void test('邀请码不含易混字符（I/L/O/0/1，仅检查随机后缀）', () => {
  for (let i = 0; i < 50; i += 1) {
    const code = createInviteCode('2026-09-12');
    const suffix = code.split('-')[2] ?? '';
    assert.doesNotMatch(suffix, /[ILO01]/, `后缀包含易混字符：${code}`);
  }
});

void test('邀请码具有随机性（连续生成不重复）', () => {
  const codes = new Set<string>();
  for (let i = 0; i < 100; i += 1) codes.add(createInviteCode('2026-09-12'));
  assert.ok(codes.size > 90, `100 次生成应几乎不重复，实际唯一值 ${codes.size}`);
});
