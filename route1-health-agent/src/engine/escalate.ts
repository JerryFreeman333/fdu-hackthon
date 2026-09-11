/** 家属协同策略：只在真正需要时提示，并受老人家庭共享授权控制。 */
import type { FamilySharing, Finding, Severity } from '../types';

export interface FamilyNotification {
  finding: Finding;
  message: string;
  actionPath?: string;
  reason: string;
  oneTime: boolean;
}

export const FAMILY_LEVELS: Severity[] = ['alert', 'urgent'];

/**
 * 仅送今日 finding 给家属。历史 finding 由上层 UI 过滤不进入推送队列。
 */
export function collectFamilyNotifications(
  findings: Finding[],
  familySharing: FamilySharing,
  oneTimeSharedFindingIds: string[] = [],
  today: string = '',
): FamilyNotification[] {
  const sharedIds = new Set(oneTimeSharedFindingIds);
  return findings
    .filter(
      (finding) =>
        FAMILY_LEVELS.includes(finding.severity) &&
        finding.familyMessage &&
        finding.familyEligible === true &&
        (today === '' || finding.date === today) &&
        (familySharing === 'granted' || sharedIds.has(finding.id)),
    )
    .map((finding) => ({
      finding,
      message: finding.familyMessage as string,
      actionPath: finding.carePath,
      reason:
        finding.severity === 'urgent' ? '出现需要立即确认的安全信号。' : '多项变化叠加，系统认为今天值得家属主动确认。',
      oneTime: sharedIds.has(finding.id),
    }));
}

export function severityBadge(sev: Severity): { text: string; className: string } {
  switch (sev) {
    case 'urgent':
      return { text: '紧急', className: 'badge-urgent' };
    case 'alert':
      return { text: '建议关注', className: 'badge-alert' };
    case 'watch':
      return { text: '持续观察', className: 'badge-watch' };
    default:
      return { text: '小提示', className: 'badge-info' };
  }
}
