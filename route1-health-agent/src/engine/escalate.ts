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
 *
 * `familyEligible` 的语义对齐项目里其余调用点（App.tsx / useElderChat /
 * agent.ts / context.ts）的默认行为：未显式拒绝（!== false）即视为可推送。
 * 仪表盘披露仍走 familyDisclosure.ts 的严格门（familyEligible === true）；
 * 通知派发是"安全信号是否真的送到家属手上"的兜底，默认更宽松，是为了避免
 * 检测引擎漏标 familyEligible 时把紧急/严重事件静默吞掉。
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
        finding.familyEligible !== false &&
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

/**
 * 与 collectFamilyNotifications 同一判定源的反向集合：
 * 今日存在、但没有进入家属通知的 alert/urgent 发现——按"挡住的原因"分两类：
 *
 * - 类型 A（授权门控）：familyMessage 存在且 familyEligible 未拒绝，内容本可共享，
 *   只是 familySharing !== 'granted' 且未一次性共享；
 * - 类型 B（内容私密）：老人未授权共享导致 visibility='private'，安全规则因此
 *   生成的是"无 familyMessage / familyEligible=false"的变体（如 safety.fall）。
 *   内容永远对家属保密，但"系统知道有紧急信号"这个事实必须对家属可见。
 *
 * 这就是"第三种未知"：不是没数据，而是有数据但被隐私设置挡住。
 * 家属首页状态必须看到这个数量，否则会把被挡住的紧急信号表述成"今天总体正常"
 * （评审现场一：老人 02:42 报胸痛，家属 02:44 打开看到"今天总体正常"；
 * 评审现场二：老人从未授权共享就报摔跤，private 的 urgent 发现从真相视图里蒸发）。
 * 只暴露数量，不暴露内容——家属无权看到发现本身。
 */
export function collectGatedFindings(
  findings: Finding[],
  familySharing: FamilySharing,
  oneTimeSharedFindingIds: string[] = [],
  today: string = '',
): Finding[] {
  const sharedIds = new Set(oneTimeSharedFindingIds);
  return findings.filter((finding) => {
    if (!FAMILY_LEVELS.includes(finding.severity)) return false;
    if (today !== '' && finding.date !== today) return false;
    // 类型 A：内容可共享、只差授权；已被授权（长期或一次性）的会进入通知，不算被挡
    if (finding.familyMessage && finding.familyEligible !== false) {
      return !(familySharing === 'granted' || sharedIds.has(finding.id));
    }
    // 类型 B：内容私密（无 familyMessage 或 familyEligible=false）。
    // 无论授权状态如何，内容都不可见——这正是"被挡住"本身。
    return true;
  });
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
