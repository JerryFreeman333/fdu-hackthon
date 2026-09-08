import type { ElderSubject } from './understanding';

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

/**
 * 让老人明确知道“AI听懂了谁”，避免只说“家里人”造成被听漏的感觉。
 * 原话短句优先回显，不重新编造健康事实。
 */
export function buildFamilyAcknowledgement(claims: FamilyAcknowledgementClaim[]): string {
  const usable = claims.filter((claim) => claim.text.trim()).slice(0, 2);
  if (usable.length === 0) return '';
  const parts = usable.map((claim) => `${subjectLabel(claim.subject)}：${claim.text.trim()}`);
  return `我也听到您说的是：${parts.join('；')}。这部分只记在家人近况里，不会记到您本人的健康档案。`;
}
