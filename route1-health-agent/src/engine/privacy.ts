import type { FamilySharing } from '../types';

export type PrivacyIntent = 'none' | 'private' | 'no_record' | 'share_family';

export function parsePrivacyIntent(text: string): PrivacyIntent {
  if (/(不要|别).{0,4}(记录|记下来|保存)/.test(text)) return 'no_record';
  if (/(不要|别).{0,4}(告诉|让).{0,3}(孩子|女儿|儿子|家人)/.test(text)) return 'private';
  if (/(告诉|通知|跟).{0,4}(孩子|女儿|儿子|家人)/.test(text)) return 'share_family';
  return 'none';
}

export function canShareWithFamily(sharing: FamilySharing, intent: PrivacyIntent): boolean {
  if (intent === 'private') return false;
  if (intent === 'share_family') return sharing !== 'denied';
  return sharing === 'granted';
}

export function sharingLabel(sharing: FamilySharing): string {
  switch (sharing) {
    case 'granted':
      return '已同意在必要时与家属共享';
    case 'ask':
      return '需要先征求您的同意';
    default:
      return '暂不与家属共享';
  }
}
