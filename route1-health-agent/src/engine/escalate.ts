/** 分级通知策略 —— 核心原则：平时不打扰家属，需要时才说话 */
import type { Finding, Severity } from '../types';

export interface FamilyNotification {
  finding: Finding;
  /** 推送给家属的完整文案 */
  message: string;
  /** 建议的行动路径 */
  actionPath?: string;
}

/** 哪些等级会通知家属：只有 alert（建议关注）和 urgent（需要尽快处理） */
export const FAMILY_LEVELS: Severity[] = ['alert', 'urgent'];

/**
 * 从检测结果里筛出应该推送给家属的通知。
 * watch/info 只留在应用内提醒老人，不外发。
 */
export function collectFamilyNotifications(findings: Finding[]): FamilyNotification[] {
  return findings
    .filter((f) => FAMILY_LEVELS.includes(f.severity) && f.familyMessage)
    .map((f) => ({
      finding: f,
      message: f.familyMessage as string,
      actionPath: f.carePath,
    }));
}

/** 应用内给老人看的提醒（所有等级都显示，但措辞已按等级区分） */
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
