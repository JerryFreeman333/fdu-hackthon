/**
 * 家属通知派发引擎。
 * 通知不能只停留在页面内存里：这里负责把 escalation 的门控结果转成持久化的投递台账，
 * 逐渠道记录真实送达状态，并维护「新通知 → 家属确认」的闭环。
 * 门控（隐私授权 + familyEligible + familyMessage）只认 collectFamilyNotifications 一个事实源。
 */
import type { FamilySharing, Finding } from '../types';
import { collectFamilyNotifications, type FamilyNotification } from './escalate';

export type DeliveryChannel = 'in_app' | 'browser_push' | 'webhook_push';
export type DeliveryStatus = 'sent' | 'failed' | 'unavailable';

export interface DeliveryAttempt {
  channel: DeliveryChannel;
  status: DeliveryStatus;
  detail: string;
  at: string;
}

export interface DeliveryOutcome {
  channel: DeliveryChannel;
  status: DeliveryStatus;
  detail: string;
}

export type NotificationLifecycle = 'new' | 'acknowledged';

export interface FamilyNotificationRecord {
  findingId: string;
  severity: 'alert' | 'urgent';
  title: string;
  message: string;
  actionPath?: string;
  reason: string;
  createdAt: string;
  deliveries: DeliveryAttempt[];
  lifecycle: NotificationLifecycle;
  acknowledgedAt?: string;
}

export type DeliverFn = (notification: FamilyNotification) => DeliveryOutcome[] | Promise<DeliveryOutcome[]>;

export interface DispatchResult {
  records: FamilyNotificationRecord[];
  dispatchedCount: number;
}

const SEVERITY_ORDER: Record<FamilyNotificationRecord['severity'], number> = { urgent: 0, alert: 1 };

export function sortNotificationRecords(records: FamilyNotificationRecord[]): FamilyNotificationRecord[] {
  return [...records].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      b.createdAt.localeCompare(a.createdAt) ||
      a.findingId.localeCompare(b.findingId),
  );
}

/**
 * 派发一轮家属通知：
 * - 未绑定家属时不派发（没有收件人就没有投递可言，也不生成台账）；
 * - 以 findingId 为唯一键去重，同一条发现绝不重复打扰；
 * - 每条记录都先写入「通知中心已送达」，再叠加渠道投递结果；渠道抛错时如实记为 failed。
 */
export async function dispatchFamilyNotifications(
  findings: Finding[],
  familySharing: FamilySharing,
  familyBound: boolean,
  existing: FamilyNotificationRecord[],
  now: string,
  deliver: DeliverFn,
  /** 老人一次性共享且尚未消费的 findingId：同样属于 collectFamilyNotifications 的门控结果。 */
  oneTimeSharedFindingIds: string[] = [],
): Promise<DispatchResult> {
  const eligible = familyBound ? collectFamilyNotifications(findings, familySharing, oneTimeSharedFindingIds) : [];
  const knownIds = new Set(existing.map((record) => record.findingId));
  const fresh = eligible.filter((notification) => !knownIds.has(notification.finding.id));

  const records = [...existing];
  for (const notification of fresh) {
    if (notification.finding.severity !== 'alert' && notification.finding.severity !== 'urgent') continue;
    const attempts: DeliveryAttempt[] = [
      { channel: 'in_app', status: 'sent', detail: '已进入家属端通知中心', at: now },
    ];
    try {
      const outcomes = await deliver(notification);
      for (const outcome of outcomes) attempts.push({ ...outcome, at: now });
    } catch (error) {
      attempts.push({
        channel: 'browser_push',
        status: 'failed',
        detail: error instanceof Error ? error.message : '通知渠道调用失败',
        at: now,
      });
    }
    records.push({
      findingId: notification.finding.id,
      severity: notification.finding.severity,
      title: notification.finding.title,
      message: notification.message,
      actionPath: notification.actionPath,
      reason: notification.reason,
      createdAt: now,
      deliveries: attempts,
      lifecycle: 'new',
    });
  }

  return { records: sortNotificationRecords(records), dispatchedCount: records.length - existing.length };
}

/** 家属确认通知。只允许 new → acknowledged，重复确认保留最早确认时间。 */
export function acknowledgeNotification(
  records: FamilyNotificationRecord[],
  findingId: string,
  at: string,
): FamilyNotificationRecord[] {
  return records.map((record) =>
    record.findingId === findingId && record.lifecycle === 'new'
      ? { ...record, lifecycle: 'acknowledged', acknowledgedAt: at }
      : record,
  );
}

export function countUnacknowledged(records: FamilyNotificationRecord[]): number {
  return records.filter((record) => record.lifecycle === 'new').length;
}

const CHANNEL_LABELS: Record<DeliveryChannel, string> = {
  in_app: '通知中心',
  browser_push: '系统通知',
  webhook_push: '微信推送',
};

/** 把投递台账压缩成一句家属能看懂的送达状态，不夸大也不含糊。 */
export function describeDeliveries(record: FamilyNotificationRecord): string {
  const parts: string[] = [];
  for (const channel of ['in_app', 'browser_push', 'webhook_push'] as const) {
    const attempt = record.deliveries.find((item) => item.channel === channel);
    if (!attempt) continue;
    if (attempt.status === 'sent') parts.push(`${CHANNEL_LABELS[channel]}已送达`);
    else parts.push(`${CHANNEL_LABELS[channel]}未送达（${attempt.detail}）`);
  }
  return parts.join('；') || '暂无投递记录';
}
