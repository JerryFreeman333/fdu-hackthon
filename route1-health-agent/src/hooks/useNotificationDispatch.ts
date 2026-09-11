import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FamilySharing, Finding } from '../types';
import type { FamilyLink } from '../types';
import {
  acknowledgeNotification as acknowledgeRecord,
  countUnacknowledged,
  dispatchFamilyNotifications,
  sortNotificationRecords,
  type DeliveryOutcome,
  type DeliverFn,
  type FamilyNotificationRecord,
} from '../engine/notify';
import { sendBrowserPush } from '../adapters/BrowserNotificationChannel';
import { loadDispatchRecords, saveDispatchRecords } from '../engine/notifyPersistence';

function isUndeliveredPush(record: FamilyNotificationRecord): boolean {
  return record.deliveries.some(
    (delivery) =>
      delivery.channel === 'browser_push' && (delivery.status === 'failed' || delivery.status === 'unavailable'),
  );
}

/**
 * 把"安全信号是否真正送到家属手上"接到 UI 上。
 *
 * - 仅当家属已绑定（familyLink.status === 'active'）且长期授权为 granted 时
 *   才会真正调起派发引擎；其余状态只做门控评估，不发任何渠道。
 * - 同一 finding 永不重复打扰家属：dedup 完全交给 notify.ts 的台账去管。
 * - 渠道抛错不吞：deliver 抛错会被 notify.ts 记成 failed，UI 上能看到。
 * - 状态走 React 内存，与项目其它 session-only 状态保持一致；
 *   跨刷新去重留到下一轮专门处理。
 */
interface UseNotificationDispatchOptions {
  findings: Finding[];
  familySharing: FamilySharing;
  familyLink: FamilyLink | null;
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

  const isDispatchable = familyLink?.status === 'active' && familySharing === 'granted';

  const effectiveDeliver = useCallback<DeliverFn>(
    async (notification) => {
      if (deliver) return deliver(notification);
      // 默认走浏览器系统通知；adapter 内部对不支持/未授权/抛错都会返回
      // 明确的 DeliveryOutcome，台账如实记录，绝不假装送达。
      const outcome: DeliveryOutcome = sendBrowserPush(
        `family-${notification.finding.id}`,
        notification.finding.title,
        notification.message,
      );
      return [outcome];
    },
    [deliver],
  );

  useEffect(() => {
    if (!isDispatchable) {
      lastDispatchedSignatureRef.current = '';
      return;
    }
    // 仅当发现列表真的发生变化时才再跑派发，避免每帧重复触发系统通知。
    const signature = findings
      .filter((finding) => finding.severity === 'alert' || finding.severity === 'urgent')
      .map(
        (finding) =>
          `${finding.id}:${finding.familyEligible !== false ? 'eligible' : 'blocked'}:${finding.familyMessage ? 'msg' : 'nomsg'}`,
      )
      .sort()
      .join('|');
    if (signature === lastDispatchedSignatureRef.current) return;
    lastDispatchedSignatureRef.current = signature;

    let cancelled = false;
    void (async () => {
      const now = new Date().toISOString();
      const result = await dispatchFamilyNotifications(
        findings,
        familySharing,
        true,
        recordsRef.current,
        now,
        effectiveDeliver,
      );
      if (cancelled) return;
      setRecords(result.records);
    })();
  }, [findings, familySharing, isDispatchable, effectiveDeliver]);

  // 跨刷新重试：上次会话推送失败（权限被拒 / 浏览器不支持 / 抛错）且未被家属确认的
  // 记录，在新会话里如果能派发了，就把推送重跑一次，避免"上次没送到就一直不送"。
  // 用 once-only 信号 + 同步 deliveredInSession 字段防止无限重试。
  useEffect(() => {
    if (!isDispatchable) return;
    const initial = recordsRef.current;
    const needsRetry = initial.filter((record) => record.lifecycle === 'new').filter(isUndeliveredPush);
    if (needsRetry.length === 0) return;

    let cancelled = false;
    void (async () => {
      for (const record of needsRetry) {
        if (cancelled) return;
        const outcome: DeliveryOutcome = sendBrowserPush(`family-${record.findingId}`, record.title, record.message);
        if (cancelled) return;
        const at = new Date().toISOString();
        setRecords((current) =>
          current.map((item) =>
            item.findingId === record.findingId
              ? {
                  ...item,
                  deliveries: item.deliveries.map((delivery) =>
                    delivery.channel === 'browser_push' ? { ...outcome, at } : delivery,
                  ),
                }
              : item,
          ),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // 只在 mount + isDispatchable 翻转时跑一次，不要因为 records 变化再次重试。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDispatchable]);

  const acknowledge = useCallback((findingId: string) => {
    const at = new Date().toISOString();
    setRecords((current) => acknowledgeRecord(current, findingId, at));
  }, []);

  // 跨 tab 同步入口：另一 tab 把它的台账或确认动作同步过来时，由 App.tsx 调用。
  // mergeRecord 用 findingId 去重，避免把同一 finding 的本地记录覆盖成远端稍旧的版本。
  const mergeRecord = useCallback((incoming: FamilyNotificationRecord) => {
    setRecords((current) => {
      const known = current.find((record) => record.findingId === incoming.findingId);
      if (known) {
        // 保留本地已确认时间，避免被远端未确认版本覆盖
        if (known.lifecycle === 'acknowledged' && incoming.lifecycle !== 'acknowledged') return current;
        return current.map((record) => (record.findingId === incoming.findingId ? incoming : record));
      }
      return sortNotificationRecords([...current, incoming]);
    });
  }, []);

  const mergeAcknowledge = useCallback((findingId: string) => {
    const at = new Date().toISOString();
    setRecords((current) => acknowledgeRecord(current, findingId, at));
  }, []);

  const pendingUnacknowledged = useMemo(() => countUnacknowledged(records), [records]);

  return { records, pendingUnacknowledged, acknowledge, mergeRecord, mergeAcknowledge };
}
