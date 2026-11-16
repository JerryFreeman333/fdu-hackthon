/**
 * 语义产物 → HomeTwinSnapshot 的唯一入口。
 *
 * 语义产物是在 COLMAP 任意坐标系（`colmap-arbitrary`）里、明确声明没有米制标定的
 * 数据。它可以用来说明"系统在哪几张画面里看到了什么物体"，但不能被当成
 * 已对齐到查看器的 3D 坐标，更不能凭空生成风险结论。
 *
 * 这里做两件事：
 * 1. 严格校验产物与本次拍摄的绑定关系（schema/坐标系/homeId/capturedAt/尺度）；
 * 2. 保留产物里合法的 relations / routes（缺失时退化为空数组），
 *    让路线规划能使用真实的空间连接证据，而不是永远拿到空关系。
 */
import type { HomeObject, HomeRoute, HomeRoom, HomeTwinSnapshot, SpatialRelation } from './model.ts';
import { validateHomeTwin } from './model.ts';

export interface SemanticArtifact {
  schemaVersion: number;
  localization: {
    coordinateFrame: string;
    metricScaleAvailable: boolean;
  };
  snapshot: HomeTwinSnapshot;
}

export interface ParseSemanticResult {
  snapshot: HomeTwinSnapshot | null;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * 解析并校验语义产物。任何一条硬约束不满足就整体拒绝——半个快照比没有快照更危险，
 * 因为下游会把"部分成功"当成完整空间证据。
 */
export function parseSemanticArtifact(
  payload: unknown,
  expected: { homeId?: string; capturedAt?: string } = {}
): ParseSemanticResult {
  const errors: string[] = [];
  if (!isRecord(payload)) return { snapshot: null, errors: ['语义产物不是对象'] };
  if (payload.schemaVersion !== 1) errors.push('语义产物版本不受支持');

  const localization = payload.localization;
  if (!isRecord(localization)) {
    errors.push('语义产物缺少定位声明');
  } else {
    if (localization.coordinateFrame !== 'colmap-arbitrary') errors.push('语义产物坐标系不是明确的 COLMAP 任意坐标系');
    if (localization.metricScaleAvailable !== false) errors.push('语义产物声称已有米制尺度，拒绝按未标定数据处理');
  }

  const raw = payload.snapshot;
  if (!isRecord(raw)) return { snapshot: null, errors: [...errors, '语义产物缺少 Home Twin 快照'] };
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) errors.push('快照 schemaVersion 不受支持');
  if (typeof raw.homeId !== 'string' || !raw.homeId) errors.push('快照缺少 homeId');
  if (expected.homeId && raw.homeId !== expected.homeId) errors.push('快照 homeId 与本次拍摄不匹配');
  if (typeof raw.capturedAt !== 'string' || !raw.capturedAt) errors.push('快照缺少 capturedAt');
  if (expected.capturedAt && raw.capturedAt !== expected.capturedAt) errors.push('快照 capturedAt 与本次拍摄不匹配');
  if (raw.scaleConfidence !== 0) errors.push('快照声称已有尺度标定；当前语义产物必须保持 scaleConfidence=0');

  const rooms = asArray<HomeRoom>(raw.rooms);
  const objects = asArray<HomeObject>(raw.objects);
  const relations = asArray<SpatialRelation>(raw.relations);
  const routes = asArray<HomeRoute>(raw.routes);
  if (!Array.isArray(raw.rooms)) errors.push('快照缺少房间列表');
  if (!Array.isArray(raw.objects)) errors.push('快照缺少物品列表');
  // relations/routes 是可选字段：语义流水线当前显式输出空数组。缺失按空处理，
  // 但一旦提供就必须通过 validateHomeTwin 的引用完整性检查。
  if (raw.relations !== undefined && !Array.isArray(raw.relations)) errors.push('快照 relations 不是数组');
  if (raw.routes !== undefined && !Array.isArray(raw.routes)) errors.push('快照 routes 不是数组');

  // 语义产物里的物品只能来自视觉识别。'demo' / 'inferred' 混进来，等于把预置或
  // 猜测的位置冒充成本次拍摄看到的证据。
  for (const object of objects) {
    if (!isRecord(object) || object.source !== 'vision') {
      errors.push('语义产物包含非视觉来源的物品');
      break;
    }
    const evidence = object.evidence;
    if (!isRecord(evidence) || !Array.isArray(evidence.imageIds) || evidence.imageIds.length === 0) {
      errors.push('语义产物包含没有画面证据的物品');
      break;
    }
  }

  if (errors.length > 0) return { snapshot: null, errors };

  const snapshot: HomeTwinSnapshot = {
    homeId: raw.homeId as string,
    version: typeof raw.version === 'number' ? raw.version : 1,
    capturedAt: raw.capturedAt as string,
    scaleConfidence: 0,
    rooms,
    objects,
    relations,
    routes
  };

  const validationErrors = validateHomeTwin(snapshot);
  if (validationErrors.length > 0) return { snapshot: null, errors: validationErrors };
  return { snapshot, errors: [] };
}

export interface CaptureHomeSummary {
  homeId: string;
  status?: string;
  modelReady?: boolean;
  modelUrl?: string | null;
  semanticReady?: boolean;
  semanticUrl?: string | null;
  capturedAt?: string;
}

export async function fetchCaptureHome(
  homeId: string,
  fetchImpl: typeof fetch = fetch
): Promise<CaptureHomeSummary | null> {
  try {
    const response = await fetchImpl(`/api/route2/homes/${encodeURIComponent(homeId)}`);
    if (!response.ok) return null;
    return (await response.json()) as CaptureHomeSummary;
  } catch {
    return null;
  }
}

/**
 * 拉取并解析本次拍摄的语义产物。
 * semanticReady / semanticUrl 任一不成立就返回 null——不猜、不把模型外观当成识别结果。
 */
export async function loadSemanticSnapshot(
  home: CaptureHomeSummary | null,
  fetchImpl: typeof fetch = fetch
): Promise<ParseSemanticResult> {
  if (!home) return { snapshot: null, errors: ['没有可用的家庭空间'] };
  if (!home.semanticReady || !home.semanticUrl) {
    return { snapshot: null, errors: ['本次拍摄没有可用的视觉识别结果'] };
  }
  try {
    const response = await fetchImpl(home.semanticUrl);
    if (!response.ok) return { snapshot: null, errors: [`语义产物读取失败: HTTP ${response.status}`] };
    return parseSemanticArtifact(await response.json(), { homeId: home.homeId, capturedAt: home.capturedAt });
  } catch (error) {
    return { snapshot: null, errors: [error instanceof Error ? error.message : '语义产物读取失败'] };
  }
}

const FINDABLE_CATEGORY_TITLES: Partial<Record<HomeObject['category'], string>> = {
  bed: '床',
  door: '门',
  toilet: '卫生间',
  rug: '地毯',
  cable: '地面线缆',
  threshold: '门槛/高差'
};

export interface SnapshotItem {
  id: string;
  title: string;
  location: string;
  say: string;
}

/**
 * 把快照里的物品转成"找东西"可用的文字条目。
 *
 * 刻意不返回任何 3D 坐标：语义产物是 COLMAP 任意坐标系，尚未与查看器对齐；
 * 把未对齐的坐标画成房间里的光圈，就是在伪造"东西就在那儿"。
 */
export function itemsFromSnapshot(snapshot: HomeTwinSnapshot): SnapshotItem[] {
  const roomLabels = new Map(snapshot.rooms.map(room => [room.id, room.label]));
  return snapshot.objects
    .filter(object => Boolean(FINDABLE_CATEGORY_TITLES[object.category]))
    .map(object => {
      const room = roomLabels.get(object.roomId) ?? '未标注房间';
      const images = object.evidence?.imageIds?.length ?? 0;
      return {
        id: object.id,
        title: FINDABLE_CATEGORY_TITLES[object.category] ?? object.label,
        // 当前语义流水线不做房间划分，所有物体都落在"待分区"里。
        // 与其把"待分区"当成房间名念给老人听，不如直接说清楚还缺什么。
        location: object.locationText ?? (room === '待分区' ? '房间尚未自动划分' : room),
        say: `识别置信度 ${Math.round(object.confidence * 100)}%，画面证据 ${images} 张。坐标尚未与查看器对齐，先按文字位置寻找；不确定时请让家人确认。`
      };
    });
}
