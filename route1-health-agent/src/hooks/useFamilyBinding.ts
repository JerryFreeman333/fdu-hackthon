import { useState } from 'react';
import type { ElderProfile, FamilyLink } from '../types';
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

function createInviteCode(today: string): string {
  // Demo 级别的 4 位数字邀请码：仅用于单设备演示绑定，真实产品必须由服务端签发高熵授权。
  const random =
    typeof crypto !== 'undefined' && 'getRandomValues' in crypto
      ? crypto.getRandomValues(new Uint32Array(1))[0] % 10000
      : Math.floor(Math.random() * 10000);
  return `AN-${today.slice(0, 4)}-${random.toString().padStart(4, '0')}`;
}

interface UseFamilyBindingOptions {
  showToast: (text: string) => void;
  /** 注入的"今天"（评审 P1-4）：邀请码年份跟随当前日期，不再用模块加载时常量。 */
  today: string;
}

/**
 * Demo-only family authorization state.
 * Security-sensitive state deliberately lives in React memory and is not restored from localStorage.
 * Family binding, consent, invite codes, and one-time grants expire with the current browser session.
 * One-time grants stay held for the whole session and are only cleared by revoke/reset:
 * the family view must be able to show exactly what the elder was told was shared.
 */
export function useFamilyBinding({ showToast, today }: UseFamilyBindingOptions) {
  const [familySharing, setFamilySharing] = useState<ElderProfile['familySharing']>('denied');
  const [consentUpdatedAt, setConsentUpdatedAt] = useState('');
  const [familyLink, setFamilyLink] = useState<FamilyLink | null>(null);
  const [issuedInviteCode, setIssuedInviteCode] = useState<string | null>(null);
  const [sharedFindingIds, setSharedFindingIds] = useState<string[]>([]);
  const [sharedFamilyEventIds, setSharedFamilyEventIds] = useState<string[]>([]);

  function updateFamilySharing(next: ElderProfile['familySharing']) {
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

  return {
    familySharing,
    consentUpdatedAt,
    familyLink,
    sharedFindingIds,
    sharedFamilyEventIds,
    promptFamilyShare,
    requestFamilyShare,
    keepFamilyPrivate,
    revokeFamilyShare,
    generateInvite,
    bindFamily,
    confirmLinkRequest,
    shareFindingIds,
    shareFamilyEventIds,
  };
}
