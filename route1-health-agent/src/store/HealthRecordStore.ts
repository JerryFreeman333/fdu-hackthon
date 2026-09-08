import type { ChatMessage, DayRecord, FamilyHealthEvent, HealthMeasurement, LabResult, Observation } from '../types';
import type { HealthEvent } from '../pipeline/events';

export interface HealthRecordSnapshot {
  /** 老人本人唯一事实来源：统一健康事件流。 */
  events: HealthEvent[];
  /** 家庭成员事实账本，与老人事件流隔离，不参与本人检测。 */
  familyEvents: FamilyHealthEvent[];
  chat: ChatMessage[];
}

/**
 * 持久化边界。
 * 当前使用浏览器本地存储；未来替换成后端 API/数据库时，Agent/Detection 不需要改变。
 */
export interface HealthRecordStore {
  load(): HealthRecordSnapshot;
  save(snapshot: HealthRecordSnapshot): void;
  clear(): void;
}

/** 仅用于旧 localStorage 数据迁移的兼容类型。 */
export interface LegacyHealthRecordSnapshot {
  records?: DayRecord[];
  observations?: Observation[];
  labResults?: LabResult[];
  measurements?: HealthMeasurement[];
  familyEvents?: FamilyHealthEvent[];
  chat?: ChatMessage[];
}
