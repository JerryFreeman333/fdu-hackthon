import type { ElderProfile, UserRole } from '../types';
import { profile as demoProfile } from '../data/demo';

/** 数据模式：demo = 预置演示档案与合成数据；personal = 用户本人建档，从空白开始（评审 P1-2）。 */
export type DataMode = 'demo' | 'personal';

export interface StoredProfile {
  version: 1;
  profile: ElderProfile;
  dataMode: DataMode;
  /** 首次由用户明确选择；缺失表示旧档案，必须重新询问。 */
  preferredRole?: UserRole;
}

const KEY = 'ankang-route1-profile-v1';

function isValidProfile(value: unknown): value is ElderProfile {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ElderProfile>;
  return typeof candidate.name === 'string' && candidate.name.trim().length > 0;
}

/** 结构校验：旧版本/坏数据一律视为没有档案（与 PersistentHealthRecordStore 的容错一致）。 */
export function isValidStoredProfile(value: unknown): value is StoredProfile {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<StoredProfile>;
  return candidate.version === 1 && isValidProfile(candidate.profile);
}

/** 读取本机档案；任何缺失/坏数据都按"没有档案"处理，回到首启选择。 */
export function loadStoredProfile(): StoredProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredProfile;
    if (!isValidStoredProfile(parsed)) return null;
    return {
      version: 1,
      profile:
        parsed.dataMode !== 'personal' && !parsed.profile.medicationRecords
          ? {
              ...parsed.profile,
              sex: parsed.profile.sex ?? 'female',
              medicationRecords: demoProfile.medicationRecords?.filter(
                (record) => record.status === 'stopped' || parsed.profile.medications.includes(record.name),
              ),
            }
          : parsed.profile,
      dataMode: parsed.dataMode === 'personal' ? 'personal' : 'demo',
      preferredRole:
        parsed.preferredRole === 'elder' || parsed.preferredRole === 'family' ? parsed.preferredRole : undefined,
    };
  } catch {
    return null;
  }
}

export function saveStoredProfile(stored: StoredProfile): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // 隐私模式/配额满：档案留在内存，本次会话可用。
  }
}

export function clearStoredProfile(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // 同上
  }
}

/** 演示档案（王秀兰奶奶）作为可选的首启入口，不再是唯一身份。 */
export function demoStoredProfile(preferredRole?: UserRole): StoredProfile {
  return { version: 1, profile: { ...demoProfile }, dataMode: 'demo', preferredRole };
}

/** 建档起点：除了 familySharing 默认 ask，其余字段留白/中性默认。 */
export function emptyProfile(): ElderProfile {
  return {
    name: '',
    age: 0,
    conditions: [],
    medications: [],
    familyContact: '',
    familyPhone: '',
    communityDoctorPhone: '',
    mobility: 'independent',
    usesCane: false,
    nightVision: 'normal',
    cognition: 'stable',
    familySharing: 'ask',
  };
}
