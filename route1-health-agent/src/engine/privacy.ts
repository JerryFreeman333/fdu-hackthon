import type { FamilySharing } from '../types';

/** 明确的告知动作：告诉/通知 + 家人称谓（这两个动词本身就意味着“把事情说给对方”）。 */
export const TELLS_FAMILY = /(?:告诉|通知).{0,2}\s*(?:孩子|女儿|儿子|家人|家里人)/;
/** 跟/让 是歧义动词，必须接到“说/讲/知道”才算分享：“让儿子回来一趟”不是分享意图。 */
export const ASKS_FAMILY_RELAY = /(?:跟|让).{0,2}\s*(?:孩子|女儿|儿子|家人|家里人).{0,3}?(?:知道|说|讲)/;

export type PrivacyIntent = 'none' | 'private' | 'no_record' | 'share_family';

export function parsePrivacyIntent(text: string): PrivacyIntent {
  const wantsNoRecord = /(不要|别).{0,4}(记录|记下来|保存)/.test(text);
  const refusesFamily =
    /(?:不要|别|不想|不希望|不愿意|不愿|不需要).{0,4}(告诉|让|通知).{0,3}(孩子|女儿|儿子|家人|他|她|他们|她们)/.test(
      text,
    ) ||
    /(?:不想|不希望|不愿意|不愿|不需要).{0,2}(?:让|叫)?(?:孩子|女儿|儿子|家人).{0,3}(?:知道|看见)/.test(text) ||
    /不想让.{0,3}(孩子|女儿|儿子|家人).{0,3}(知道|看见|知道这件事)/.test(text);
  const requestsFamily = TELLS_FAMILY.test(text) || ASKS_FAMILY_RELAY.test(text);

  if (wantsNoRecord) return 'no_record';
  if (refusesFamily && requestsFamily) return 'private';
  if (refusesFamily) return 'private';
  if (requestsFamily) return 'share_family';
  return 'none';
}

/** A one-time explicit share overrides the persistent default for that statement only. */
export function canShareWithFamily(sharing: FamilySharing, intent: PrivacyIntent): boolean {
  if (intent === 'private' || intent === 'no_record') return false;
  if (intent === 'share_family') return true;
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
