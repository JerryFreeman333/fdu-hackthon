import type { ElderSubject } from './understanding';

export type FamilyShareMode = 'private' | 'persistent' | 'one_time';

export interface FamilyAcknowledgementClaim {
  subject: Exclude<ElderSubject, 'self' | 'unknown'>;
  text: string;
}

function subjectLabel(subject: FamilyAcknowledgementClaim['subject']): string {
  switch (subject) {
    case 'spouse':
      return '您爱人';
    case 'father':
      return '您爸爸';
    case 'mother':
      return '您妈妈';
    default:
      return '您的家人';
  }
}

function sharingNotice(shareMode: FamilyShareMode): string {
  switch (shareMode) {
    case 'one_time':
      return '这次会分享给家属一次，不会打开长期共享。';
    case 'persistent':
      return '按您现在的授权，家属可以看到必要的变化。';
    default:
      return '这部分不会共享给家属。';
  }
}

/**
 * 让老人明确知道“AI听懂了谁”，并把本次分享与长期共享明确区分。
 * 原话短句优先回显，不重新编造健康事实。
 */
export function buildFamilyAcknowledgement(
  claims: FamilyAcknowledgementClaim[],
  shareMode: FamilyShareMode = 'private',
): string {
  const usable = claims.filter((claim) => claim.text.trim()).slice(0, 2);
  if (usable.length === 0) return '';
  const parts = usable.map((claim) => `${subjectLabel(claim.subject)}：${claim.text.trim()}`);
  return `我也听到您说的是：${parts.join('；')}。${sharingNotice(shareMode)}不会记到您本人的健康档案。`;
}

/** 让老人知道一次性或长期共享时，实际对家属开放了哪些本人事实。 */
export function buildSelfSharingAcknowledgement(recordSummary: string, shareMode: FamilyShareMode): string {
  const summary = recordSummary.trim();
  if (!summary) return '';
  const scope = shareMode === 'one_time' ? '这次分享给家属一次的是' : '按您现在的授权，家属可以看到的是';
  const duration = shareMode === 'one_time' ? '不会打开长期共享。' : '只限必要的健康变化。';
  return `${scope}：${summary}。${duration}`;
}
