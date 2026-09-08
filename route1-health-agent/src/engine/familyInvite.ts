import type { FamilyLink } from '../types';

export const INVITE_PREFIX = 'ankang-personal-invite:';
export const FAMILY_LINK_KEY = 'ankang-personal-family-link-v1';
export const DEMO_ELDER_ID = 'demo-elder-route1';

export function normalizeInviteCode(input: string): string {
  const compact = input
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s\u200B-\u200D\uFEFF‐‑‒–—−-]/g, '');
  return /^AN\d{8}$/.test(compact) ? `AN-${compact.slice(2, 6)}-${compact.slice(6)}` : '';
}

export function bindLocalInvite(storage: Pick<Storage, 'getItem' | 'setItem'>, input: string): FamilyLink {
  const inviteCode = normalizeInviteCode(input);
  if (!inviteCode) throw new Error('请填写完整邀请码，例如 AN-2026-1234。只输入最后四位不能绑定。');
  let raw: string | null;
  try {
    raw = storage.getItem(`${INVITE_PREFIX}${inviteCode}`);
  } catch {
    throw new Error('无法读取浏览器保存的邀请码，请检查浏览器存储权限后重试。');
  }
  if (!raw)
    throw new Error(
      '当前页面找不到这个邀请码。请在生成邀请码的同一浏览器、同一网址中，用右上角“切换身份”进入家属端；换手机、浏览器或端口暂时不能绑定。',
    );
  let invite: { elderId?: string; relation?: string } | null;
  try {
    invite = JSON.parse(raw);
  } catch {
    throw new Error('保存的邀请码记录已损坏，请回到老人端重新生成。');
  }
  if (!invite || invite.elderId !== DEMO_ELDER_ID) throw new Error('邀请码记录不匹配，请回到老人端重新生成。');
  const link: FamilyLink = {
    id: `family-${Date.now()}`,
    relation: '家属',
    displayName: '本地演示家属',
    maskedContact: '本地设备',
    inviteCode,
    status: 'active',
  };
  try {
    storage.setItem(FAMILY_LINK_KEY, JSON.stringify(link));
  } catch {
    throw new Error('绑定结果未能保存，请检查浏览器存储权限后重试。');
  }
  return link;
}
