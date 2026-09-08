import { useEffect, useState } from 'react';
import type { ElderProfile, FamilyLink } from '../types';
import { TODAY } from '../data/demo';
import { bindLocalInvite, INVITE_PREFIX, FAMILY_LINK_KEY, DEMO_ELDER_ID } from '../engine/familyInvite';

const CONSENT_KEY = 'ankang-personal-consent-v1';
const SHARED_FINDING_IDS_KEY = 'ankang-personal-shared-findings-v1';

function localIsoTimestamp(): string {
  return new Date().toISOString();
}

function loadFamilySharing(): { familySharing: ElderProfile['familySharing']; updatedAt: string } {
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY);
    if (!raw) return { familySharing: 'ask', updatedAt: '' };
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
  return { familySharing: 'ask', updatedAt: '' };
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

function loadSharedFindingIds(): string[] {
  try {
    const raw = window.localStorage.getItem(SHARED_FINDING_IDS_KEY);
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
  onStorageError?: () => void;
}

export function useFamilyBinding({ showToast, onStorageError }: UseFamilyBindingOptions) {
  const [initialConsent] = useState(loadFamilySharing);
  const [familySharing, setFamilySharing] = useState<ElderProfile['familySharing']>(initialConsent.familySharing);
  const [consentUpdatedAt, setConsentUpdatedAt] = useState(initialConsent.updatedAt);
  const [familyLink, setFamilyLink] = useState<FamilyLink | null>(() => loadFamilyLink());
  const [sharedFindingIds, setSharedFindingIds] = useState<string[]>(() => loadSharedFindingIds());

  useEffect(() => {
    function refreshLink() {
      const consent = loadFamilySharing();
      setFamilySharing(consent.familySharing);
      setConsentUpdatedAt(consent.updatedAt);
      setSharedFindingIds(loadSharedFindingIds());
      const next = loadFamilyLink();
      setFamilyLink((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
    }
    function syncLink(event: StorageEvent) {
      if (
        event.storageArea === window.localStorage &&
        ([FAMILY_LINK_KEY, CONSENT_KEY, SHARED_FINDING_IDS_KEY].includes(event.key ?? '') || event.key === null)
      )
        refreshLink();
    }
    window.addEventListener('storage', syncLink);
    window.addEventListener('focus', refreshLink);
    return () => {
      window.removeEventListener('storage', syncLink);
      window.removeEventListener('focus', refreshLink);
    };
  }, []);

  function updatePersistentFamilySharing(next: ElderProfile['familySharing']) {
    const updatedAt = localIsoTimestamp();
    try {
      window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ familySharing: next, updatedAt }));
    } catch {
      onStorageError?.();
      throw new Error('共享设置未保存');
    }
    setFamilySharing(next);
    setConsentUpdatedAt(updatedAt);
    return updatedAt;
  }

  function requestFamilyShare() {
    const updatedAt = updatePersistentFamilySharing('granted');
    showToast(`已同意在必要时与家属共享。授权记录时间：${updatedAt.slice(0, 10)}`);
  }

  function keepFamilyPrivate() {
    window.localStorage.setItem(SHARED_FINDING_IDS_KEY, '[]');
    setSharedFindingIds([]);
    updatePersistentFamilySharing('denied');
    showToast('好的，先不告诉家属。之后需要时，您可以再打开共享。');
  }

  function revokeFamilyShare() {
    window.localStorage.setItem(SHARED_FINDING_IDS_KEY, '[]');
    setSharedFindingIds([]);
    updatePersistentFamilySharing('denied');
    showToast('已暂停家属共享。老人本人仍可继续使用助手。');
  }

  function generateInvite() {
    try {
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
      window.localStorage.setItem(FAMILY_LINK_KEY, JSON.stringify(link));
      setFamilyLink(link);
      showToast(`邀请码已生成：${code}`);
    } catch {
      onStorageError?.();
      showToast('邀请码未保存，请检查浏览器存储后重试。');
    }
  }

  function bindFamily(inviteCode: string): string | null {
    try {
      const link = bindLocalInvite(window.localStorage, inviteCode);
      setFamilyLink(link);
      showToast('家属绑定成功（本地 Demo）。');
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : '浏览器存储不可用，请检查权限后重试。';
    }
  }

  function shareFindingIds(ids: string[]) {
    if (ids.length === 0) return;
    const next = [...new Set([...loadSharedFindingIds(), ...ids])].slice(-50);
    window.localStorage.setItem(SHARED_FINDING_IDS_KEY, JSON.stringify(next));
    setSharedFindingIds(next);
  }

  return {
    familySharing,
    consentUpdatedAt,
    familyLink,
    sharedFindingIds,
    requestFamilyShare,
    keepFamilyPrivate,
    revokeFamilyShare,
    generateInvite,
    bindFamily,
    shareFindingIds,
  };
}
