/**
 * 家属通知派发引擎。
 * 通知不能只停留在页面内存里：这里负责把 escalation 的门控结果转成持久化的投递台账，
 * 逐渠道记录真实送达状态，并维护「新通知 → 家属确认」的闭环。
 * 门控（隐私授权 + familyEligible + familyMessage）只认 collectFamilyNotifications 一个事实源。
 */
import type { FamilySharing, Finding } from '../types';
import { collectFamilyNotifications, type FamilyNotification } from './escalate';
import { formatLocalDate } from './clock';
import { isFamilySafetyFinding } from './familySafetyNotify';

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
  /** 最近一次内容升级的时间；旧记录没有该字段。 */
  updatedAt?: string;
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

function severityRank(severity: FamilyNotificationRecord['severity']): number {
  return severity === 'urgent' ? 2 : 1;
}

/**
 * 判断一条新通知是否构成对既有台账记录的"有意义升级"。
 *
 * 旧实现只用 findingId 去重，同一天先从 alert 升级到 urgent 时第二次派发被整条吞掉：
 * 家属端永远停留在旧的 alert 文案，系统却认为已经通知过。
 * 现在同 id 允许更新，但只允许"升级或同级内容变化"，不允许把已经送达的紧急告警
 * 悄悄降级——历史送达记录不能被后续更正擦掉。
 */
function isUpgrade(existing: FamilyNotificationRecord, incoming: FamilyNotification): boolean {
  const nextSeverity =
    incoming.finding.severity === 'urgent' ? 'urgent' : incoming.finding.severity === 'alert' ? 'alert' : null;
  if (!nextSeverity) return false;
  if (severityRank(nextSeverity) > severityRank(existing.severity)) return true;
  if (severityRank(nextSeverity) < severityRank(existing.severity)) return false;
  return (
    existing.title !== incoming.finding.title ||
    existing.message !== incoming.message ||
    existing.actionPath !== incoming.actionPath
  );
}

/** 本地日历日：跨午夜重推必须按用户所在时区判断，不能拿 UTC 日期切片。 */
function localDayKey(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso.slice(0, 10);
  return formatLocalDate(parsed);
}

/**
 * 家人安全事件的"按天重申"：昨天发生/报告、家属仍未确认的急症，
 * 今天必须再次进入推送。确认过的、当天已经推过的都不重发；
 * 其他 finding 保持原有"同一 id 只派发一次/升级重发"的语义。
 */
function shouldRepeatUnacknowledgedFamilySafety(
  previous: FamilyNotificationRecord | undefined,
  notification: FamilyNotification,
  now: string,
): boolean {
  if (!previous || previous.lifecycle !== 'new') return false;
  if (!isFamilySafetyFinding(notification.finding)) return false;
  return localDayKey(previous.updatedAt ?? previous.createdAt) < localDayKey(now);
}

export function mergeNotificationRecord(
  current: FamilyNotificationRecord[],
  incoming: FamilyNotificationRecord,
): FamilyNotificationRecord[] {
  const known = current.find((record) => record.findingId === incoming.findingId);
  if (!known) return sortNotificationRecords([...current, incoming]);
  const incomingVersion = incoming.updatedAt ?? incoming.createdAt;
  const knownVersion = known.updatedAt ?? known.createdAt;
  if (incomingVersion < knownVersion || severityRank(incoming.severity) < severityRank(known.severity)) return current;
  const changedContent =
    incoming.severity !== known.severity ||
    incoming.title !== known.title ||
    incoming.message !== known.message ||
    incoming.actionPath !== known.actionPath;
  const keepAcknowledgement = known.lifecycle === 'acknowledged' && !changedContent;
  const deliveries = new Map(incoming.deliveries.map((attempt) => [attempt.channel, attempt]));
  if (incomingVersion === knownVersion) {
    for (const attempt of known.deliveries) {
      const next = deliveries.get(attempt.channel);
      if (!next || attempt.at > next.at || (attempt.at === next.at && attempt.status === 'sent')) {
        deliveries.set(attempt.channel, attempt);
      }
    }
  }
  const merged: FamilyNotificationRecord = {
    ...incoming,
    deliveries: [...deliveries.values()],
    ...(keepAcknowledgement ? { lifecycle: 'acknowledged', acknowledgedAt: known.acknowledgedAt } : {}),
  };
  if (JSON.stringify(known) === JSON.stringify(merged)) return current;
  return sortNotificationRecords(current.map((record) => (record.findingId === incoming.findingId ? merged : record)));
}

export function sortNotificationRecords(records: FamilyNotificationRecord[]): FamilyNotificationRecord[] {
  return [...records].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      b.createdAt.localeCompare(a.createdAt) ||
      a.findingId.localeCompare(b.findingId),
  );
}

/**
 * 评审 P0-1 修复：把派发台账记录还原成家属端可渲染的通知视图。
 *
 * 跨设备（PeerJS）场景下家属端没有老人的健康事件流，无法本地重跑检测，
 * 派发台账是它唯一的通知内容来源；同浏览器场景下台账与本地检测结果
 * 按 findingId 合并去重。台账记录本身就是老人端授权门控之后的产物，
 * 所以从台账渲染天然不会泄漏未授权内容。
 * createdAt 是 UTC ISO，展示日期必须先转本地日期（不能用 toISOString 语义）。
 */
export function ledgerRecordToNotification(record: FamilyNotificationRecord): FamilyNotification {
  return {
    finding: {
      id: record.findingId,
      // 台账的“提醒日期”以最近一次更新为准：昨天报告、今天重申的急症
      // 不能在消息页继续显示成昨天的提醒。
      date: formatLocalDate(new Date(record.updatedAt ?? record.createdAt)),
      severity: record.severity,
      title: record.title,
      detail: record.message,
      evidence: [],
      familyMessage: record.message,
      carePath: record.actionPath,
    },
    message: record.message,
    actionPath: record.actionPath,
    reason: record.reason,
    oneTime: false,
  };
}

/**
 * 台账记录是否属于"今天"（按本地日期判断；today 为空表示不过滤）。
 *
 * 必须看 `updatedAt`：家人安全事件隔天重申时 `createdAt` 仍是第一次报告的
 * 日期，只看它会把这轮重推过滤掉，导致“台账更新了、家属端却没有任何推送”。
 */
export function isRecordFromToday(record: FamilyNotificationRecord, today: string): boolean {
  if (!today) return true;
  const parsed = new Date(record.updatedAt ?? record.createdAt);
  return !Number.isNaN(parsed.getTime()) && formatLocalDate(parsed) === today;
}

/**
 * 派发一轮家属通知：
 * - 未绑定家属时不派发（没有收件人就没有投递可言，也不生成台账）；
 * - 以 findingId 为唯一键去重；同级不重复，升级必须重发；
 * - 家人安全事件在仍未确认时允许隔天重申；
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
  const known = new Map(existing.map((record) => [record.findingId, record]));

  const records = [...existing];
  let changedCount = 0;
  for (const notification of eligible) {
    if (notification.finding.severity !== 'alert' && notification.finding.severity !== 'urgent') continue;
    const previous = known.get(notification.finding.id);
    if (
      previous &&
      !isUpgrade(previous, notification) &&
      !shouldRepeatUnacknowledgedFamilySafety(previous, notification, now)
    )
      continue;

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
    const next: FamilyNotificationRecord = {
      findingId: notification.finding.id,
      severity: notification.finding.severity,
      title: notification.finding.title,
      message: notification.message,
      actionPath: notification.actionPath,
      reason: notification.reason,
      createdAt: previous?.createdAt ?? now,
      updatedAt: previous ? now : undefined,
      deliveries: attempts,
      // 升级后必须重新进入"待确认"：家属确认过旧的 alert，不代表已经知道新的 urgent。
      lifecycle: 'new',
    };
    if (previous) {
      const index = records.findIndex((record) => record.findingId === notification.finding.id);
      records[index] = next;
    } else {
      records.push(next);
    }
    changedCount += 1;
  }

  return { records: sortNotificationRecords(records), dispatchedCount: changedCount };
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

export type RetryablePushChannel = Extract<DeliveryChannel, 'browser_push' | 'webhook_push'>;

/**
 * 上次会话里哪些推送渠道真的没送到。旧实现只看 browser_push，
 * 微信推送失败后永远不会重试；这里把两个外送渠道都纳入，并保持
 * “已送达的渠道不重发”的去重语义。
 */
export function pendingRetryChannels(record: FamilyNotificationRecord): RetryablePushChannel[] {
  return record.deliveries
    .filter(
      (delivery): delivery is DeliveryAttempt & { channel: RetryablePushChannel } =>
        (delivery.channel === 'browser_push' || delivery.channel === 'webhook_push') &&
        (delivery.status === 'failed' || delivery.status === 'unavailable'),
    )
    .map((delivery) => delivery.channel);
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
