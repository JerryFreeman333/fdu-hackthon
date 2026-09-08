import { useEffect, useState } from 'react';
import type { ElderProfile, FamilyLink } from '../types';
import { TODAY, profile } from '../data/demo';

const CONSENT_KEY = 'ankang-route1-consent-v2';
const FAMILY_LINK_KEY = 'ankang-route1-family-link-v1';
const SHARED_FINDING_IDS_KEY = 'ankang-route1-shared-findings-v1';
const SHARED_FAMILY_EVENT_IDS_KEY = 'ankang-route1-shared-family-events-v1';
const INVITE_PREFIX = 'ankang-route1-invite:';
const DEMO_ELDER_ID = 'demo-elder-route1';

function localIsoTimestamp(): string {
  return new Date().toISOString();
}

function loadFamilySharing(): { familySharing: ElderProfile['familySharing']; updatedAt: string } {
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY);
    if (!raw) return { familySharing: profile.familySharing, updatedAt: '' };
    if (raw === 'granted' || raw === 'ask' || raw === 'denied') return { familySharing: raw, updatedAt: '' };
    const parsed = JSON.parse(raw) as { familySharing?: ElderProfile['familySharing']; updatedAt?: string };
    if (parsed.familySharing === 'granted' || parsed.familySharing === 'ask' || parsed.familySharing === 'denied') {
      return {
        familySharing: parsed.familySharing,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      };
    }
  } catch {
    // fall back to the demo account's initial consent state
  }
  return { familySharing: profile.familySharing, updatedAt: '' };
}

function loadFamilyLink(): FamilyLink | null {
  try {
    const raw = window.localStorage.getItem(FAMILY_LINK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FamilyLink;
    return parsed && typeof parsed.inviteCode === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function loadStringIds(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(-50) : [];
  } catch {
    return [];
  }
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

export function useFamilyBinding({ showToast }: UseFamilyBindingOptions) {
  const [initialConsent] = useState(loadFamilySharing);
  const [familySharing, setFamilySharing] = useState<ElderProfile['familySharing']>(initialConsent.familySharing);
  const [consentUpdatedAt, setConsentUpdatedAt] = useState(initialConsent.updatedAt);
  const [familyLink, setFamilyLink] = useState<FamilyLink | null>(() => loadFamilyLink());
  const [sharedFindingIds, setSharedFindingIds] = useState<string[]>(() => loadStringIds(SHARED_FINDING_IDS_KEY));
  const [sharedFamilyEventIds, setSharedFamilyEventIds] = useState<string[]>(() =>
    loadStringIds(SHARED_FAMILY_EVENT_IDS_KEY),
  );

  useEffect(() => {
    window.localStorage.setItem(
      CONSENT_KEY,
      JSON.stringify({ familySharing, updatedAt: consentUpdatedAt || localIsoTimestamp() }),
    );
    if (familyLink) window.localStorage.setItem(FAMILY_LINK_KEY, JSON.stringify(familyLink));
    else window.localStorage.removeItem(FAMILY_LINK_KEY);
    window.localStorage.setItem(SHARED_FINDING_IDS_KEY, JSON.stringify(sharedFindingIds.slice(-50)));
    window.localStorage.setItem(SHARED_FAMILY_EVENT_IDS_KEY, JSON.stringify(sharedFamilyEventIds.slice(-50)));
  }, [familySharing, consentUpdatedAt, familyLink, sharedFindingIds, sharedFamilyEventIds]);

  function updatePersistentFamilySharing(next: ElderProfile['familySharing']) {
    const updatedAt = localIsoTimestamp();
    setFamilySharing(next);
    setConsentUpdatedAt(updatedAt);
    return updatedAt;
  }

  function requestFamilyShare() {
    const updatedAt = updatePersistentFamilySharing('granted');
    showToast(`已同意在必要时与家属共享。授权记录时间：${updatedAt.slice(0, 10)}`);
  }

  function keepFamilyPrivate() {
    updatePersistentFamilySharing('denied');
    setSharedFindingIds([]);
    setSharedFamilyEventIds([]);
    showToast('好的，先不告诉家属。之后需要时，您可以再打开共享。');
  }

  function revokeFamilyShare() {
    updatePersistentFamilySharing('denied');
    setSharedFindingIds([]);
    setSharedFamilyEventIds([]);
    showToast('已暂停家属共享。历史的一次性分享也已撤销，老人本人仍可继续使用助手。');
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
    window.localStorage.setItem(
      `${INVITE_PREFIX}${code}`,
      JSON.stringify({ elderId: DEMO_ELDER_ID, relation: '家属' }),
    );
    setFamilyLink(link);
    showToast(`邀请码已生成：${code}`);
  }

  function bindFamily(inviteCode: string): boolean {
    if (!inviteCode) return false;
    try {
      const raw = window.localStorage.getItem(`${INVITE_PREFIX}${inviteCode}`);
      if (!raw) return false;
      const invite = JSON.parse(raw) as { elderId?: string; relation?: string };
      if (invite.elderId !== DEMO_ELDER_ID) return false;
      const link: FamilyLink = {
        id: `family-${Date.now()}`,
        relation: invite.relation ?? '家属',
        displayName: '本地演示家属',
        maskedContact: '本地设备',
        inviteCode,
        status: 'active',
      };
      setFamilyLink(link);
      showToast('家属绑定成功（本地 Demo）。');
      return true;
    } catch {
      return false;
    }
  }

  function shareFindingIds(ids: string[]) {
    if (ids.length === 0) return;
    setSharedFindingIds((current) => [...new Set([...current, ...ids])].slice(-50));
  }

  function shareFamilyEventIds(ids: string[]) {
    if (ids.length === 0) return;
    setSharedFamilyEventIds((current) => [...new Set([...current, ...ids])].slice(-50));
  }

  return {
    familySharing,
    consentUpdatedAt,
    familyLink,
    sharedFindingIds,
    sharedFamilyEventIds,
    requestFamilyShare,
    keepFamilyPrivate,
    revokeFamilyShare,
    generateInvite,
    bindFamily,
    shareFindingIds,
    shareFamilyEventIds,
  };
}
