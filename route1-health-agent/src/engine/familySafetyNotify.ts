/**
 * 家人安全事件 → 家属通知的唯一转换点。
 *
 * 设计红线：
 * - 只吃 `FamilySafetyItem`（已由 visibleFamilySafetyEvents 做过 visibility /
 *   familyEligible / shareMode 门控），绝不直接吃原始 FamilyHealthEvent。
 * - 生成的是标准 `Finding`：severity 固定 urgent（产品确认五类事件都不降级），
 *   后续进入与老人本人告警完全相同的派发、台账、确认与重试链路。
 * - `date` 是**本次提醒日期**，不是事件发生日期：collectFamilyNotifications
 *   只送"今天"，昨天发生、今天才报告的急症仍然需要今天推送。当前窗口内
 *   昨天已报告、但家属仍未确认的事件，今天由派发台账再次重申；确认过的
 *   不重复。发生日期保留在 familyMessage 里，不能让家属把昨天的跌倒
 *   误读成刚刚发生。
 */
import type { Finding } from '../types';
import type { FamilySafetyItem } from './familyLedger';

export const FAMILY_SAFETY_RULE_ID = 'family.safety';
export const FAMILY_SAFETY_FINDING_PREFIX = 'family-safety:';

export function familySafetyFindingId(eventId: string): string {
  return `${FAMILY_SAFETY_FINDING_PREFIX}${eventId}`;
}

export function isFamilySafetyFinding(finding: Finding): boolean {
  return finding.ruleId === FAMILY_SAFETY_RULE_ID || finding.id.startsWith(FAMILY_SAFETY_FINDING_PREFIX);
}

export function familySafetyFinding(item: FamilySafetyItem, alertDate: string = item.reportedDate): Finding {
  return {
    id: familySafetyFindingId(item.id),
    // 通知日期是"这次提醒发生在哪一天"，不是事件发生日期。当前窗口内的
    // 事件每天重新构建一次 finding；是否再次派发由派发台账的确认状态决定。
    date: alertDate,
    severity: 'urgent',
    title: item.title,
    detail: item.message,
    evidence: [`老人转述原话：${item.text}`],
    familyMessage: `【紧急】${item.date}：${item.title}。${item.message}`,
    carePath: item.message,
    ruleId: FAMILY_SAFETY_RULE_ID,
    score: 5,
    signalKeys: [...item.tags],
    familyEligible: true,
  };
}
