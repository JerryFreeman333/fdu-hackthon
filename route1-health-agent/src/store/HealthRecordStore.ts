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
 * 健康数据存储抽象。
 * Demo 当前实现为会话内存存储，避免敏感健康数据跨浏览器会话残留。
 * 未来替换成后端 API/数据库时，Agent/Detection 不需要改变；生产实现必须按账号/老人身份做服务端隔离与授权校验。
 */
export interface HealthRecordStore {
  load(): HealthRecordSnapshot;
  save(snapshot: HealthRecordSnapshot): void;
  clear(): void;
}

/** 仅用于保留旧版结构定义；当前 Demo 不再从 localStorage 迁移健康数据。 */
export interface LegacyHealthRecordSnapshot {
  records?: DayRecord[];
  observations?: Observation[];
  labResults?: LabResult[];
  measurements?: HealthMeasurement[];
  familyEvents?: FamilyHealthEvent[];
  chat?: ChatMessage[];
}
