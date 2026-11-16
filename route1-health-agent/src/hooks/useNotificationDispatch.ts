import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FamilySharing, Finding } from '../types';
import type { FamilyLink } from '../types';
import {
  acknowledgeNotification as acknowledgeRecord,
  countUnacknowledged,
  dispatchFamilyNotifications,
  pendingRetryChannels,
  mergeNotificationRecord,
  type DeliveryOutcome,
  type DeliverFn,
  type FamilyNotificationRecord,
} from '../engine/notify';
import { sendBrowserPush } from '../adapters/BrowserNotificationChannel';
import { loadWebhookConfig, sendWebhookPush } from '../adapters/WebhookPushChannel';
import { loadDispatchRecords, saveDispatchRecords } from '../engine/notifyPersistence';
import { dispatchSignature } from '../engine/dispatchSignature';
import { FAMILY_SAFETY_FINDING_PREFIX, isFamilySafetyFinding } from '../engine/familySafetyNotify';
import { collectFamilyNotifications } from '../engine/escalate';

/**
 * 把"安全信号是否真正送到家属手上"接到 UI 上。
 *
 * - 仅当家属已绑定（familyLink.status === 'active'）且长期授权为 granted 时
 *   才会真正调起派发引擎；其余状态只做门控评估，不发任何渠道。
 * - 同一 finding 默认不重复打扰家属；家人安全事件在未确认时允许隔天重申。
 *   dedup 完全交给 notify.ts 的台账去管。
 * - 渠道抛错不吞：deliver 抛错会被 notify.ts 记成 failed，UI 上能看到。
 * - 状态走 React 内存，与项目其它 session-only 状态保持一致；
 *   跨刷新去重留到下一轮专门处理。
 */
interface UseNotificationDispatchOptions {
  findings: Finding[];
  familySharing: FamilySharing;
  familyLink: FamilyLink | null;
  /**
   * 评审 P0-1 修复：是否允许本实例真正派发通知。授权的权威实例（老人端 /
   * 同 tab 切换角色）为 true；从网络学到授权的家属消费端（remoteConsent 非空）
   * 为 false——它的台账完全来自 dispatch.append 同步，自己再派发会与老人端
   * 双重弹系统通知、双重发微信推送。默认 true 保持既有调用兼容。
   */
  canDispatch?: boolean;
  /**
   * 老人显式一次性共享的 findingId（含家人安全通道）。长期授权为 denied 时，
   * 这些 finding 仍然必须走派发；只把它们画进页面而不产生台账，就是把
   * “这次会告诉家属”变成一句空话。
   */
  oneTimeSharedFindingIds?: string[];
  /**
   * 老人端不为自己转述的家人事件弹本机系统通知：弹出对象错了，
   * 而且会让老人误以为“家属已经收到”。微信外送与家属端补发不受影响。
   */
  suppressBrowserPushForFamilySafety?: boolean;
  /** 测试/演练时允许注入自定义 deliver（例如不真弹系统通知） */
  deliver?: DeliverFn;
}

interface DispatchOutcome {
  records: FamilyNotificationRecord[];
  pendingUnacknowledged: number;
}

export function useNotificationDispatch({
  findings,
  familySharing,
  familyLink,
  canDispatch = true,
  oneTimeSharedFindingIds = [],
  suppressBrowserPushForFamilySafety = false,
  deliver,
}: UseNotificationDispatchOptions): DispatchOutcome & {
  acknowledge: (findingId: string) => void;
  mergeRecord: (record: FamilyNotificationRecord) => void;
  mergeAcknowledge: (findingId: string) => void;
} {
  const [records, setRecords] = useState<FamilyNotificationRecord[]>(() => loadDispatchRecords());
  const lastDispatchedSignatureRef = useRef<string>('');
  // 派发引擎做去重要拿到最新的台账，但 records 进 deps 会让 effect 每帧都跑。
  // 用 ref 把它从依赖里拿出来，effect 只跟 findings + 授权闸门绑在一起。
  const recordsRef = useRef(records);
  recordsRef.current = records;

  // 跨刷新持久化：mount 时从 localStorage 拉台账，恢复 dedup 状态；
  // 每次 records 变化同步写回，避免刷新后重复派发同一条通知。
  // 写入失败（隐私模式 / 配额满）由 helper 内部吞掉，不影响内存台账。
  useEffect(() => {
    saveDispatchRecords(records);
  }, [records]);

  const hasOneTimeShare = oneTimeSharedFindingIds.length > 0;
  const isDispatchable =
    canDispatch && familyLink?.status === 'active' && (familySharing === 'granted' || hasOneTimeShare);
  const dispatchableRef = useRef(isDispatchable);
  dispatchableRef.current = isDispatchable;
  const eligibleIdsRef = useRef(new Set<string>());
  eligibleIdsRef.current = new Set(
    collectFamilyNotifications(findings, familySharing, oneTimeSharedFindingIds).map(
      (notification) => notification.finding.id,
    ),
  );
  const dispatchQueueRef = useRef(Promise.resolve());

  const effectiveDeliver = useCallback<DeliverFn>(
    async (notification) => {
      if (deliver) return deliver(notification);
      // 渠道一：浏览器系统通知；adapter 内部对不支持/未授权/抛错都返回
      // 明确的 DeliveryOutcome，台账如实记录，绝不假装送达。
      const suppressBrowserPush = suppressBrowserPushForFamilySafety && isFamilySafetyFinding(notification.finding);
      const outcomes: DeliveryOutcome[] = suppressBrowserPush
        ? [
            {
              channel: 'browser_push',
              status: 'unavailable',
              detail: '老人端不为自己转述的家人事件弹本机通知',
            },
          ]
        : [sendBrowserPush(`family-${notification.finding.id}`, notification.finding.title, notification.message)];
      // 渠道二（评审 P0-6/P1-3）：配置了微信推送时把同一条通知推到家属微信，
      // 不依赖"家属此刻开着这个网页"。失败同样进台账，绝不静默。
      const webhookConfig = loadWebhookConfig();
      if (webhookConfig) {
        outcomes.push(
          await sendWebhookPush(webhookConfig, {
            title: notification.finding.title,
            body: notification.message,
          }),
        );
      }
      return outcomes;
    },
    [deliver, suppressBrowserPushForFamilySafety],
  );

  useEffect(() => {
    if (!isDispatchable) {
      lastDispatchedSignatureRef.current = '';
      return;
    }
    // 仅当发现列表真的发生变化时才再跑派发，避免每帧重复触发系统通知。
    // 严重度、正文和日期都必须进入签名：同一天从 alert 升级到 urgent、
    // 或家人安全事件跨午夜重申，只要签名不变，派发 effect 就不会重跑。
    const signature = dispatchSignature(findings, oneTimeSharedFindingIds);
    if (signature === lastDispatchedSignatureRef.current) return;
    lastDispatchedSignatureRef.current = signature;

    dispatchQueueRef.current = dispatchQueueRef.current.then(async () => {
      if (!dispatchableRef.current || signature !== lastDispatchedSignatureRef.current) return;
      const now = new Date().toISOString();
      const result = await dispatchFamilyNotifications(
        findings,
        familySharing,
        true,
        recordsRef.current,
        now,
        effectiveDeliver,
        oneTimeSharedFindingIds,
      );
      setRecords((current) => result.records.reduce(mergeNotificationRecord, current));
    });
  }, [findings, familySharing, isDispatchable, effectiveDeliver, oneTimeSharedFindingIds]);

  // 失败重试：浏览器通知/微信推送失败（权限被拒、不支持、网络错误）且未确认的记录，
  // 只重跑失败的那个渠道。旧实现只在 mount 时跑一次——会话中途权限被拒绝、网络恢复
  // 都不会再试，台账永远停在 failed。
  // 上限：每条记录最多重试 3 次，避免一个长期失败的 webhook 每 60 秒骚扰一次。
  const retryCountsRef = useRef<Map<string, number>>(new Map());
  const retryInFlightRef = useRef(false);

  const retryFailedChannels = useCallback(async (): Promise<void> => {
    if (retryInFlightRef.current || !dispatchableRef.current) return;
    retryInFlightRef.current = true;
    try {
      const needsRetry = recordsRef.current
        .filter((record) => record.lifecycle === 'new')
        .filter((record) => eligibleIdsRef.current.has(record.findingId))
        .map((record) => ({
          record,
          channels: pendingRetryChannels(record).filter(
            (channel) =>
              !(
                channel === 'browser_push' &&
                suppressBrowserPushForFamilySafety &&
                record.findingId.startsWith(FAMILY_SAFETY_FINDING_PREFIX)
              ),
          ),
        }))
        .filter((item) => item.channels.length > 0)
        .filter((item) => (retryCountsRef.current.get(item.record.findingId) ?? 0) < 3);
      for (const { record, channels } of needsRetry) {
        if (!dispatchableRef.current || !eligibleIdsRef.current.has(record.findingId)) continue;
        const outcomes: DeliveryOutcome[] = [];
        if (channels.includes('browser_push')) {
          outcomes.push(sendBrowserPush(`family-${record.findingId}`, record.title, record.message));
        }
        if (channels.includes('webhook_push')) {
          const webhookConfig = loadWebhookConfig();
          if (webhookConfig) {
            outcomes.push(
              await sendWebhookPush(webhookConfig, {
                title: record.title,
                body: record.message,
              }),
            );
          }
        }
        if (outcomes.length === 0) continue;
        retryCountsRef.current.set(record.findingId, (retryCountsRef.current.get(record.findingId) ?? 0) + 1);
        const at = new Date().toISOString();
        setRecords((current) =>
          current.map((item) =>
            item.findingId === record.findingId &&
            (item.updatedAt ?? item.createdAt) === (record.updatedAt ?? record.createdAt)
              ? {
                  ...item,
                  deliveries: item.deliveries.map((delivery) => {
                    const outcome = outcomes.find((entry) => entry.channel === delivery.channel);
                    return outcome ? { ...outcome, at } : delivery;
                  }),
                }
              : item,
          ),
        );
      }
    } finally {
      retryInFlightRef.current = false;
    }
  }, [suppressBrowserPushForFamilySafety]);

  useEffect(() => {
    if (!isDispatchable) return;
    void retryFailedChannels();
    const timer = window.setInterval(() => {
      void retryFailedChannels();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [isDispatchable, retryFailedChannels]);

  const acknowledge = useCallback((findingId: string) => {
    const at = new Date().toISOString();
    setRecords((current) => acknowledgeRecord(current, findingId, at));
  }, []);

  // 跨 tab 同步入口：另一 tab 把它的台账或确认动作同步过来时，由 App.tsx 调用。
  // mergeRecord 用 findingId 去重，避免把同一 finding 的本地记录覆盖成远端稍旧的版本。
  const mergeRecord = useCallback((incoming: FamilyNotificationRecord) => {
    setRecords((current) => mergeNotificationRecord(current, incoming));
  }, []);

  const mergeAcknowledge = useCallback((findingId: string) => {
    const at = new Date().toISOString();
    setRecords((current) => acknowledgeRecord(current, findingId, at));
  }, []);

  const pendingUnacknowledged = useMemo(() => countUnacknowledged(records), [records]);

  return { records, pendingUnacknowledged, acknowledge, mergeRecord, mergeAcknowledge };
}
