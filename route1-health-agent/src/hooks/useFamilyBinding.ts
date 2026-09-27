import { useCallback, useEffect, useState } from 'react';
import type { FamilyLink, FamilySharing } from '../types';
import { formatLocalDate } from '../data/demo';
import { performLinkHandshake, type FamilyLinkPayload, type LinkPeerConnection } from '../engine/familyLinkHandshake';

const MAX_PENDING_ONE_TIME_IDS = 50;

/**
 * 绑定握手的通道集合（P0-2）。App 层用 useCrossDeviceSync 的 broadcast/subscribe
 * 与 PeerJS 临时拨号组出来传入；测试里可以注入假通道。
 */
export interface FamilyLinkTransport {
  broadcast: (type: string, payload: unknown) => void;
  subscribe: (handler: (envelope: { type: string; payload: unknown }) => void) => () => void;
  dialPeer?: (code: string) => Promise<LinkPeerConnection>;
}

export type BindFamilyOutcome = { ok: true } | { ok: false; reason: 'rejected' | 'unreachable'; detail?: string };

function localIsoTimestamp(): string {
  // 本地墙上时间（无时区后缀）：slice(0, 10) 恒等于本地日期；
  // toISOString 会在 UTC+ 时区把 0-8 点的授权时间算成前一天。
  const now = new Date();
  const pad = (value: number, width = 2): string => `${value}`.padStart(width, '0');
  return `${formatLocalDate(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(
    now.getMilliseconds(),
    3,
  )}`;
}

/** 邀请码后缀字母表：去掉 I/L/O/0/1 等易混字符，方便老人口头转述。 */
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * P1（评审安全项）：邀请码是跨设备协同的唯一凭证——peer ID 由它直接推导，
 * 挂在公共信令上可被枚举拨号。旧的 4 位数字码（10^4）分钟级可穷举，
 * 连上后即可接收健康告警内容、发送确认消音。改为 32 字符表 10 位（50bit 随机，
 * 2^32 恰好被 32 整除、无取模偏差），枚举不再可行。服务端签发授权仍是正式版要求。
 * 导出仅供测试断言格式与熵（调用方一律走 generateInvite）。
 */
export function createInviteCode(today: string): string {
  const random = new Uint32Array(10);
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    crypto.getRandomValues(random);
  } else {
    for (let i = 0; i < random.length; i += 1) random[i] = Math.floor(Math.random() * 0x100000000);
  }
  let suffix = '';
  for (const value of random) suffix += INVITE_ALPHABET[value % INVITE_ALPHABET.length];
  return `AN-${today.slice(0, 4)}-${suffix}`;
}

/** 家属端收到的"老人端权威授权"（评审 P0-1 修复）：只有授权位与时间戳，没有健康内容。 */
export interface RemoteConsent {
  sharing: 'granted' | 'denied';
  updatedAt: string;
}

/**
 * 评审 P0-2 修复：绑定/授权状态的持久化。
 *
 * 之前这些状态"故意只存 React 内存"（每次刷新即蒸发），直接后果是：
 * 家属端刷新一次就丢绑定、丢授权，且旧邀请码已失效、老人端已连接时又没有
 * 重新生成入口——家属被锁死在恢复死循环里，期间错过所有通知。
 * 现在与健康数据放进同一个本机信任域（localStorage，ankang-route1- 前缀，
 * 清空本机数据时一并删除）：绑定、授权是"需要跨会话稳定"的状态，
 * 恰恰不该易碎；"暂停共享 / 清空本机数据"仍是明示出口。
 *
 * 刻意**不**持久化的：pending 邀请码与 issuedInviteCode。它们是短命的握手
 * 凭证——一旦写进共享存储，同浏览器家属 tab 会恢复出邀请码走 L1 本地比对，
 * 绕过老人端握手校验，老人端的链接永远停在 pending。丢失.pending 邀请码的
 * 代价只是"重新生成一次"，而握手语义被破坏的代价是整个信任模型。
 */
const FAMILY_STATE_STORAGE_KEY = 'ankang-route1-family-state-v1';

interface PersistedFamilyState {
  version: 1;
  familySharing: FamilySharing;
  consentUpdatedAt: string;
  /** 只有 active 绑定才持久化；pending 邀请保持会话级（见上）。 */
  familyLink: FamilyLink | null;
  sharedFindingIds: string[];
  sharedFamilyEventIds: string[];
  /** 家属端视角收到的老人端权威授权（跨端广播 / 握手回执带来），刷新后不丢。 */
  remoteConsent: RemoteConsent | null;
}

function isValidPersistedLink(value: unknown): value is FamilyLink {
  if (typeof value !== 'object' || value === null) return false;
  const link = value as Partial<FamilyLink>;
  return (
    typeof link.id === 'string' &&
    typeof link.relation === 'string' &&
    typeof link.displayName === 'string' &&
    typeof link.maskedContact === 'string' &&
    typeof link.inviteCode === 'string' &&
    (link.status === 'active' || link.status === 'pending')
  );
}

function isValidRemoteConsent(value: unknown): value is RemoteConsent {
  if (typeof value !== 'object' || value === null) return false;
  const consent = value as Partial<RemoteConsent>;
  return (consent.sharing === 'granted' || consent.sharing === 'denied') && typeof consent.updatedAt === 'string';
}

function loadPersistedFamilyState(): PersistedFamilyState {
  const empty: PersistedFamilyState = {
    version: 1,
    familySharing: 'denied',
    consentUpdatedAt: '',
    familyLink: null,
    sharedFindingIds: [],
    sharedFamilyEventIds: [],
    remoteConsent: null,
  };
  if (typeof window === 'undefined') return empty;
  try {
    const raw = window.localStorage.getItem(FAMILY_STATE_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<PersistedFamilyState>;
    if (parsed.version !== 1) return empty;
    return {
      version: 1,
      familySharing:
        parsed.familySharing === 'granted' || parsed.familySharing === 'ask' ? parsed.familySharing : 'denied',
      consentUpdatedAt: typeof parsed.consentUpdatedAt === 'string' ? parsed.consentUpdatedAt : '',
      familyLink: isValidPersistedLink(parsed.familyLink) ? parsed.familyLink : null,
      sharedFindingIds: Array.isArray(parsed.sharedFindingIds)
        ? parsed.sharedFindingIds.filter((id): id is string => typeof id === 'string').slice(-MAX_PENDING_ONE_TIME_IDS)
        : [],
      sharedFamilyEventIds: Array.isArray(parsed.sharedFamilyEventIds)
        ? parsed.sharedFamilyEventIds
            .filter((id): id is string => typeof id === 'string')
            .slice(-MAX_PENDING_ONE_TIME_IDS)
        : [],
      remoteConsent: isValidRemoteConsent(parsed.remoteConsent) ? parsed.remoteConsent : null,
    };
  } catch {
    // 隐私模式下 localStorage 可能不可用 / 内容损坏：退回内存态，不阻塞主路径。
    return empty;
  }
}

interface UseFamilyBindingOptions {
  showToast: (text: string) => void;
  /** 注入的"今天"（评审 P1-4）：邀请码年份跟随当前日期，不再用模块加载时常量。 */
  today: string;
}

/**
 * 家庭协同状态：绑定、授权、邀请码与一次性授权。
 *
 * 评审 P0-2 之前这里的状态"故意只存内存"；现在持久化到本机（见
 * FAMILY_STATE_STORAGE_KEY 注释），但**授权的权威永远在老人端**：
 * - 老人端 updateFamilySharing 改的是自己的真实授权；
 * - 家属端只通过 applyRemoteConsent 接收老人端广播/握手带来的授权，
 *   自己永远不会替老人做授权决定。
 */
export function useFamilyBinding({ showToast, today }: UseFamilyBindingOptions) {
  const persisted = loadPersistedFamilyState();
  const [familySharing, setFamilySharing] = useState<FamilySharing>(persisted.familySharing);
  const [consentUpdatedAt, setConsentUpdatedAt] = useState(persisted.consentUpdatedAt);
  const [familyLink, setFamilyLink] = useState<FamilyLink | null>(persisted.familyLink);
  const [issuedInviteCode, setIssuedInviteCode] = useState<string | null>(null);
  const [sharedFindingIds, setSharedFindingIds] = useState<string[]>(persisted.sharedFindingIds);
  const [sharedFamilyEventIds, setSharedFamilyEventIds] = useState<string[]>(persisted.sharedFamilyEventIds);
  const [remoteConsent, setRemoteConsent] = useState<RemoteConsent | null>(persisted.remoteConsent);

  // 状态变化即整体写回；单 key 单写者，天然避免多字段间的撕裂。
  // pending 邀请码 / issuedInviteCode 不落盘（见 FAMILY_STATE_STORAGE_KEY 注释）：
  // 只有 active 绑定才写，同浏览器家属 tab 不会因此拿到"本机已生成"的邀请码。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const state: PersistedFamilyState = {
        version: 1,
        familySharing,
        consentUpdatedAt,
        familyLink: familyLink?.status === 'active' ? familyLink : null,
        sharedFindingIds,
        sharedFamilyEventIds,
        remoteConsent,
      };
      window.localStorage.setItem(FAMILY_STATE_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 隐私模式 / 配额满：状态退化为内存态，不影响功能。
    }
  }, [familySharing, consentUpdatedAt, familyLink, sharedFindingIds, sharedFamilyEventIds, remoteConsent]);

  function updateFamilySharing(next: FamilySharing) {
    const updatedAt = localIsoTimestamp();
    setFamilySharing(next);
    setConsentUpdatedAt(updatedAt);
    return updatedAt;
  }

  function promptFamilyShare() {
    if (familySharing !== 'denied') return;
    updateFamilySharing('ask');
  }

  function requestFamilyShare() {
    const updatedAt = updateFamilySharing('granted');
    showToast(`已同意在必要时与家属共享。授权记录时间：${updatedAt.slice(0, 10)}`);
  }

  function clearShareAuthorization() {
    setFamilySharing('denied');
    setConsentUpdatedAt('');
    setSharedFindingIds([]);
    setSharedFamilyEventIds([]);
  }

  function keepFamilyPrivate() {
    clearShareAuthorization();
    showToast('好的，先不告诉家属。之后需要时，您可以再打开共享。');
  }

  function revokeFamilyShare() {
    clearShareAuthorization();
    showToast('已暂停家属共享。之后的新变化不会继续提供给家属；已经告诉对方的内容，我不会假装它已经被撤回。');
  }

  function generateInvite() {
    const code = createInviteCode(today);
    const link: FamilyLink = {
      id: `family-${Date.now()}`,
      relation: '家属',
      displayName: '待绑定',
      maskedContact: '未绑定',
      inviteCode: code,
      status: 'pending',
    };
    setIssuedInviteCode(code);
    setFamilyLink(link);
    showToast(`邀请码已生成：${code}（重新生成会使旧码失效）`);
  }

  /**
   * L1：同 tab 本地比对（回归路径保留）。
   * L2/L3：交给 familyLinkHandshake —— 家属端出示邀请码，拥有邀请码的老人端
   * 校验并应答。跨 tab / 跨设备不再依赖"输入方本地恰好有这个码"。
   */
  async function bindFamily(inviteCode: string, transport?: FamilyLinkTransport): Promise<BindFamilyOutcome> {
    const code = inviteCode.trim();
    if (!code) return { ok: false, reason: 'rejected', detail: 'empty_code' };
    if (issuedInviteCode && code === issuedInviteCode && familyLink) {
      activateLink(code, '本地演示家属', '本地设备');
      return { ok: true };
    }
    if (!transport) return { ok: false, reason: 'rejected', detail: 'code_mismatch' };
    const result = await performLinkHandshake({ code, ...transport });
    if (!result.ok) return { ok: false, reason: result.reason, detail: result.detail };
    setIssuedInviteCode(null);
    setFamilyLink({ ...result.link });
    // 评审 P0-1 修复：握手回执携带老人端当前授权，家属端绑定瞬间就知道
    // "老人是否允许共享"，不再依赖本 tab 自己那份恒为 denied 的本地副本。
    if (result.consent) applyRemoteConsent(result.consent);
    showToast('家属绑定成功。邀请码已失效。');
    return { ok: true };
  }

  /** 激活本地 pending 链接：老人端确认握手（confirmLinkRequest）与同 tab 绑定共用。 */
  function activateLink(code: string, displayName: string, maskedContact: string) {
    if (!familyLink) return;
    const link: FamilyLink = {
      ...familyLink,
      displayName,
      maskedContact,
      inviteCode: code,
      status: 'active',
    };
    setIssuedInviteCode(null);
    setFamilyLink(link);
  }

  /**
   * 老人端：收到家属的绑定请求时校验邀请码。码匹配 pending 邀请 → 激活绑定并
   * 返回回执（由调用方经 family.link accepted 发回家属端）；否则返回 null。
   * 安全语义：出示正确邀请码即视为老人授权（demo 级），错误码只得到 rejected。
   */
  function confirmLinkRequest(code: string): FamilyLinkPayload | null {
    if (!code || !issuedInviteCode || code !== issuedInviteCode || !familyLink) return null;
    activateLink(code, '已通过邀请码绑定的家属', '已验证邀请码');
    return {
      id: familyLink.id,
      relation: familyLink.relation,
      displayName: '已通过邀请码绑定的家属',
      maskedContact: '已验证邀请码',
      inviteCode: code,
      status: 'active',
    };
  }

  function shareFindingIds(ids: string[]) {
    if (ids.length === 0) return;
    setSharedFindingIds((current) => [...new Set([...current, ...ids])].slice(-MAX_PENDING_ONE_TIME_IDS));
  }

  function shareFamilyEventIds(ids: string[]) {
    if (ids.length === 0) return;
    setSharedFamilyEventIds((current) => [...new Set([...current, ...ids])].slice(-MAX_PENDING_ONE_TIME_IDS));
  }

  /** 家属端接收老人端广播来的权威授权；内容相同则幂等跳过。useCallback 稳定，可进 effect deps。 */
  /**
   * 家属端接收老人端广播来的权威授权；内容相同则幂等跳过。
   * 同时把本地 familySharing 采纳为该值：同浏览器多 tab 共享同一个持久化 key，
   * 若家属端只更新 remoteConsent 而保留本地 denied，整体写回会把老人端的
   * granted 覆盖回 denied，老人端刷新后授权就丢了。采纳后两端收敛一致，
   * 权威仍然只有老人端（只有它自己的 UI 会直接改 familySharing）。
   */
  const applyRemoteConsent = useCallback((next: RemoteConsent) => {
    setRemoteConsent((current) => {
      if (current && current.sharing === next.sharing && current.updatedAt === next.updatedAt) return current;
      return { sharing: next.sharing, updatedAt: next.updatedAt };
    });
    setFamilySharing(next.sharing);
    setConsentUpdatedAt((current) => (current === next.updatedAt ? current : next.updatedAt));
  }, []);

  /** 家属端解除绑定（评审 P0-2 恢复出口）：清掉本机绑定与握手中的邀请码；老人端授权不受影响。 */
  function unbindFamily() {
    setFamilyLink(null);
    setIssuedInviteCode(null);
    setRemoteConsent(null);
    showToast('已解除本机与老人端的绑定。重新绑定时需要老人端出示新的邀请码。');
  }

  return {
    familySharing,
    consentUpdatedAt,
    familyLink,
    sharedFindingIds,
    sharedFamilyEventIds,
    remoteConsent,
    promptFamilyShare,
    requestFamilyShare,
    keepFamilyPrivate,
    revokeFamilyShare,
    generateInvite,
    bindFamily,
    confirmLinkRequest,
    shareFindingIds,
    shareFamilyEventIds,
    applyRemoteConsent,
    unbindFamily,
  };
}
