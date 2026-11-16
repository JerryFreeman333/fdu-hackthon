import type { CareTask } from '../types';
import type { FamilyNotification } from './escalate';
import type { HomeSafetyAction } from '../adapters/HomeSafetyActionAdapter';
import type { FamilySafetyItem } from './familyLedger';

export type FamilyPriority =
  | { kind: 'urgent-notification'; notification: FamilyNotification }
  | { kind: 'family-safety'; item: FamilySafetyItem }
  | { kind: 'home-safety'; action: HomeSafetyAction }
  | { kind: 'notification'; notification: FamilyNotification }
  | { kind: 'task'; task: CareTask }
  | { kind: 'none' };

/**
 * 家属首页只展示“现在最需要知道的一件事”。
 * 旧实现无条件把居家安全放在最前，结果老人当天的 urgent 健康告警被一个
 * 环境风险事项压在下面。急症优先于环境风险；环境风险优先于普通通知和待办。
 */
export function selectFamilyPriority(input: {
  notification?: FamilyNotification | null;
  /** 当前窗口内已授权的家人安全事件（老人转述的家人急症/受伤）。 */
  familySafety?: FamilySafetyItem | null;
  homeAction?: HomeSafetyAction | null;
  task?: CareTask | null;
}): FamilyPriority {
  const notification = input.notification ?? null;
  const familySafety = input.familySafety ?? null;
  const homeAction = input.homeAction ?? null;
  const task = input.task ?? null;

  if (notification?.finding.severity === 'urgent') return { kind: 'urgent-notification', notification };
  // 家人急症/受伤优先于环境风险：环境风险可以等一次复扫，晕厥不能。
  if (familySafety) return { kind: 'family-safety', item: familySafety };
  if (homeAction) return { kind: 'home-safety', action: homeAction };
  if (notification) return { kind: 'notification', notification };
  if (task) return { kind: 'task', task };
  return { kind: 'none' };
}
