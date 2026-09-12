import type { ElderSubject, ClaimStatus } from './understanding';
import { SYMPTOM_LABELS } from '../types';
import type { SymptomTag } from '../types';

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
  if (!summary || shareMode === 'private') return '';
  const scope = shareMode === 'one_time' ? '这次分享给家属一次的是' : '按您现在的授权，家属可以看到的是';
  const duration = shareMode === 'one_time' ? '不会打开长期共享。' : '只限必要的健康变化。';
  return `${scope}：${summary}。${duration}`;
}

export interface UnacceptedClaimView {
  status: ClaimStatus;
  tags: SymptomTag[];
}

/**
 * 有 claim 留下、但没有一条进入本人事实流时的回复。
 * 否定/擦边（near_miss）的句子老人说得非常自然（“头一点都不晕了”“差点摔倒”），
 * 如果回一句“说的是您自己还是家里人？”式的追问，等于告诉老人“我没听懂”——
 * 所以对这两类明确判断给专用确认话术；混合了不确定/假设的句子仍走追问模板。
 */
export function buildUnacceptedClaimsReply(claims: UnacceptedClaimView[]): string {
  const labelsFor = (status: ClaimStatus): string[] =>
    [
      ...new Set(
        claims.filter((claim) => claim.status === status && claim.tags.length > 0).flatMap((claim) => claim.tags),
      ),
    ].map((tag) => SYMPTOM_LABELS[tag]);
  const hasOpenJudgment = claims.some((claim) => claim.status === 'uncertain' || claim.status === 'hypothetical');
  if (!hasOpenJudgment) {
    const negatedLabels = labelsFor('negated');
    if (negatedLabels.length > 0)
      return `好的，我知道了：您说的${negatedLabels.join('、')}没有发生，或者已经好了。这条我不会记成您的健康事件，有变化随时告诉我。`;
    const nearMissLabels = labelsFor('near_miss');
    if (nearMissLabels.length > 0)
      return `还好有惊无险，您说的${nearMissLabels.join('、')}没有真的发生。这条我不会记成健康事件，不过接下来行动慢一点，要是有哪里疼或者不舒服，马上告诉我。`;
  }
  return '我先不把这句话记成您的健康事实。您可以告诉我：说的是您自己，还是家里其他人？事情已经发生了，还是只是想问问这种情况怎么办？';
}
