import { useCallback, useState } from 'react';
import type { ElderProfile, FamilyLink } from '../types';
import { TODAY } from '../data/demo';

const MAX_PENDING_ONE_TIME_IDS = 50;

function localIsoTimestamp(): string {
  return new Date().toISOString();
}

function createInviteCode(): string {
  const random =
    typeof crypto !== 'undefined' && 'getRandomValues' in crypto
      ? crypto.getRandomValues(new Uint32Array(1))[0] % 10000
      : Math.floor(Math.random() * 10000);
  return `AN-${TODAY.slice(0, 4)}-${random.toString().padStart(4, '0')}`;
}

interface UseFamilyBindingOptions {
  showToast: (text: string) => void;
}

/**
 * Demo-only family authorization state.
 * Security-sensitive state deliberately lives in React memory and is not restored from localStorage.
 * Family binding, consent, invite codes, and one-time grants expire with the current browser session.
 */
export function useFamilyBinding({ showToast }: UseFamilyBindingOptions) {
  const [familySharing, setFamilySharing] = useState<ElderProfile['familySharing']>('denied');
  const [consentUpdatedAt, setConsentUpdatedAt] = useState('');
  const [familyLink, setFamilyLink] = useState<FamilyLink | null>(null);
  const [issuedInviteCode, setIssuedInviteCode] = useState<string | null>(null);
  const [sharedFindingIds, setSharedFindingIds] = useState<string[]>([]);
  const [sharedFamilyEventIds, setSharedFamilyEventIds] = useState<string[]>([]);
  const [claimedOneTimeFindingIds, setClaimedOneTimeFindingIds] = useState<string[]>([]);
  const [claimedOneTimeFamilyEventIds, setClaimedOneTimeFamilyEventIds] = useState<string[]>([]);

  function updateFamilySharing(next: ElderProfile['familySharing']) {
    const updatedAt = localIsoTimestamp();
    setFamilySharing(next);
    setConsentUpdatedAt(updatedAt);
    return updatedAt;
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
    setClaimedOneTimeFindingIds([]);
    setClaimedOneTimeFamilyEventIds([]);
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
    const code = createInviteCode();
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
    showToast(`邀请码已生成：${code}`);
  }

  function bindFamily(inviteCode: string): boolean {
    if (!inviteCode || !issuedInviteCode || inviteCode !== issuedInviteCode || !familyLink) return false;
    const link: FamilyLink = {
      ...familyLink,
      displayName: '本地演示家属',
      maskedContact: '本地设备',
      status: 'active',
    };
    setIssuedInviteCode(null);
    setFamilyLink(link);
    showToast('家属绑定成功（本地 Demo）。邀请码已失效。');
    return true;
  }

  function shareFindingIds(ids: string[]) {
    if (ids.length === 0) return;
    setSharedFindingIds((current) => [...new Set([...current, ...ids])].slice(-MAX_PENDING_ONE_TIME_IDS));
  }

  function shareFamilyEventIds(ids: string[]) {
    if (ids.length === 0) return;
    setSharedFamilyEventIds((current) => [...new Set([...current, ...ids])].slice(-MAX_PENDING_ONE_TIME_IDS));
  }

  const claimOneTimeShares = useCallback(
    async (candidateFindingIds: string[], candidateFamilyEventIds: string[]): Promise<void> => {
      const findingCandidates = new Set(candidateFindingIds);
      const eventCandidates = new Set(candidateFamilyEventIds);
      const findingIds = sharedFindingIds.filter((id) => findingCandidates.has(id));
      const familyEventIds = sharedFamilyEventIds.filter((id) => eventCandidates.has(id));
      if (findingIds.length === 0 && familyEventIds.length === 0) return;

      setSharedFindingIds((current) => current.filter((id) => !findingIds.includes(id)));
      setSharedFamilyEventIds((current) => current.filter((id) => !familyEventIds.includes(id)));
      setClaimedOneTimeFindingIds((current) =>
        [...new Set([...current, ...findingIds])].slice(-MAX_PENDING_ONE_TIME_IDS),
      );
      setClaimedOneTimeFamilyEventIds((current) =>
        [...new Set([...current, ...familyEventIds])].slice(-MAX_PENDING_ONE_TIME_IDS),
      );
    },
    [sharedFindingIds, sharedFamilyEventIds],
  );

  const consumeSharedFindingIds = useCallback(
    (findingIds: string[]) => {
      void claimOneTimeShares(findingIds, []);
    },
    [claimOneTimeShares],
  );

  const consumeSharedFamilyEventIds = useCallback(
    (familyEventIds: string[]) => {
      void claimOneTimeShares([], familyEventIds);
    },
    [claimOneTimeShares],
  );

  return {
    familySharing,
    consentUpdatedAt,
    familyLink,
    sharedFindingIds,
    sharedFamilyEventIds,
    claimedOneTimeFindingIds,
    claimedOneTimeFamilyEventIds,
    requestFamilyShare,
    keepFamilyPrivate,
    revokeFamilyShare,
    generateInvite,
    bindFamily,
    shareFindingIds,
    shareFamilyEventIds,
    claimOneTimeShares,
    consumeSharedFindingIds,
    consumeSharedFamilyEventIds,
  };
}
