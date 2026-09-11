import type { FamilyNotification } from './escalate';
import type { FamilyNotificationRecord } from './notify';

/**
 * 家属端首页一句话状态。
 *
 * 这一函数是"未知的诚实化"的最后一道闸：绝不能在没有真实数据时把页面
 * 显示成"今天总体正常"。两条独立路径必须把"未知"明确标出：
 * 1. notifications 为空但派发台账里仍有未被确认的系统通知失败
 *    → 系统尝试提醒但没送到位，不是"今天没事"
 * 2. notifications 为空、派发没失败、但今日信号量为零
 *    → detection 没看到东西 ≠ 老人没事，可能是今天还没说话/没戴设备/
 *    聊天解析漏掉了，必须提示家属主动确认，而不是绿色"ok"
 */
export type FamilyStatusTone = 'danger' | 'warn' | 'unknown' | 'ok';

export interface FamilyStatus {
  title: string;
  detail: string;
  tone: FamilyStatusTone;
  /** 决策理由，仅供测试与排障使用 */
  reasons: string[];
}

function hasUndeliveredPush(record: FamilyNotificationRecord): boolean {
  return record.deliveries.some(
    (delivery) =>
      delivery.channel === 'browser_push' && (delivery.status === 'failed' || delivery.status === 'unavailable'),
  );
}

export function familyStatus(
  notifications: FamilyNotification[],
  dispatchRecords: FamilyNotificationRecord[],
  todaySignalCount: number,
): FamilyStatus {
  const urgent = notifications.filter((notification) => notification.finding.severity === 'urgent');
  if (urgent.length > 0) {
    return {
      title: '今天需要立即介入',
      detail: '出现需要马上确认安全情况的信号。请先联系老人并按提示的安全路径处理。',
      tone: 'danger',
      reasons: [`urgent_notifications=${urgent.length}`],
    };
  }

  const alert = notifications.filter((notification) => notification.finding.severity === 'alert');
  if (alert.length > 0) {
    return {
      title: '今天有一件事值得关注',
      detail: '系统把多项近期变化放在一起看后，建议今天主动联系老人确认状态。',
      tone: 'warn',
      reasons: [`alert_notifications=${alert.length}`],
    };
  }

  // 没有可见通知不代表系统安好。派发台账里仍可能躺着一批未确认的系统通知失败，
  // 这些是"系统尝试提醒但没送到位"的信号，必须在首页标出来，不能装作没事。
  const undelivered = dispatchRecords.filter((record) => record.lifecycle === 'new' && hasUndeliveredPush(record));
  if (undelivered.length > 0) {
    const failed = undelivered.filter((record) =>
      record.deliveries.some((delivery) => delivery.channel === 'browser_push' && delivery.status === 'failed'),
    ).length;
    const unavailable = undelivered.length - failed;
    const detailParts: string[] = [];
    if (failed > 0) detailParts.push(`${failed} 条系统通知发送失败`);
    if (unavailable > 0) detailParts.push(`${unavailable} 条系统通知未开启`);
    return {
      title: '今天没有新通知，但系统通知未全部送达',
      detail: `有${detailParts.join('、')}。请在"现在最需要知道的"里逐条确认，或开启浏览器系统通知权限。`,
      tone: 'unknown',
      reasons: [`undelivered_pushes=${undelivered.length}`],
    };
  }

  // 沉默不等于"今天没事"：detection 没看到任何今日信号时（老人没说话、设备没上传、
  // 聊天解析漏掉等），不能给绿色 ok；必须显式标 unknown，让家属主动确认。
  if (todaySignalCount === 0) {
    return {
      title: '今天还没有任何健康信号',
      detail:
        '系统今天还没收到来自老人的主诉、聊天或设备上传，暂无数据可以判断。"没有问题"不能由系统替您说出来——建议主动联系老人确认状态，或等待他/她今天开口说一句。',
      tone: 'unknown',
      reasons: ['no_signals_today'],
    };
  }

  return {
    title: '今天总体正常',
    detail: `今日已收到 ${todaySignalCount} 条健康信号，系统判定暂无需要您介入的变化。继续观察，有变化会再提醒您。`,
    tone: 'ok',
    reasons: ['no_notifications', 'no_undelivered_records', `signals_today=${todaySignalCount}`],
  };
}
