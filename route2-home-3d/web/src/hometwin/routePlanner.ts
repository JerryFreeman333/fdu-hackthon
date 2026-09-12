import type { HomeObject, HomeRoute, HomeRoom, HomeTwinSnapshot, RouteStatus } from './model';

/** 路线不可用时的降级信息：让老人仍然能得到"上次已知在哪里"的帮助 */
export interface RouteFallback {
  /** 目标对象的文字位置（如"卫生间入口旁"），可能来自上次确认 */
  locationText?: string;
  roomLabel?: string;
  lastConfirmedAt?: string;
  evidenceImageIds?: string[];
  /** 给老人看的注意事项，例如夜间的风险提醒 */
  notes: string[];
}

export interface RoutePlanResult {
  status: RouteStatus;
  route: HomeRoute | null;
  reason?: string;
  fallback?: RouteFallback;
}

function buildFallback(
  target: HomeObject | undefined,
  rooms: HomeRoom[],
  notes: string[]
): RouteFallback | undefined {
  if (!target) return notes.length ? { notes } : undefined;
  const room = rooms.find(r => r.id === target.roomId);
  return {
    locationText: target.locationText ?? (room ? `在${room.label}内` : undefined),
    roomLabel: room?.label,
    lastConfirmedAt: target.lastConfirmedAt ?? target.observedAt,
    evidenceImageIds: target.evidence?.imageIds,
    notes
  };
}

function distance(a: HomeObject, b: HomeObject): number {
  return Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z);
}

const MIN_ENDPOINT_CONFIDENCE = 0.6;
const MIN_RELATION_CONFIDENCE = 0.6;
const ALLOWED_ROUTE_RELATION_SOURCES = new Set(['vision', 'manual', 'inferred']);

function usableRelation(relation: HomeTwinSnapshot['relations'][number]): boolean {
  return relation.relation === 'connects' &&
    Number.isFinite(relation.confidence) && relation.confidence >= MIN_RELATION_CONFIDENCE &&
    ALLOWED_ROUTE_RELATION_SOURCES.has(relation.source);
}

export function assessRouteEligibility(snapshot: HomeTwinSnapshot): { eligible: boolean; reason?: string } {
  const beds = snapshot.objects.filter(object => object.category === 'bed');
  const toilets = snapshot.objects.filter(object => object.category === 'toilet');
  if (beds.length !== 1 || toilets.length !== 1)
    return { eligible: false, reason: '无法唯一确定床和卫生间，暂不生成路线。' };
  if ([beds[0], toilets[0]].some(object => !Number.isFinite(object.confidence) ||
    object.confidence < MIN_ENDPOINT_CONFIDENCE || object.source === 'demo'))
    return { eligible: false, reason: '端点识别证据不足或仅为演示，暂不生成路线。' };
  const blocked = new Set(snapshot.relations.filter(relation => relation.relation === 'blocks').map(relation => relation.subjectId));
  if (blocked.has(beds[0].id) || blocked.has(toilets[0].id))
    return { eligible: false, reason: '路线端点存在阻断证据，暂不生成路线。' };
  const connectingRelations = snapshot.relations.filter(usableRelation);
  if (connectingRelations.length === 0)
    return { eligible: false, reason: '缺少可靠的空间连接证据，暂不生成路线。' };
  return { eligible: true };
}

/**
 * Build a graph from explicit `connects` relations and run Dijkstra between
 * the detected bed and toilet objects. Hazards marked as `blocks` are avoided.
 * This is intentionally deterministic: it never invents a route when the
 * Home Twin lacks enough spatial evidence.
 */
export function planBedToToilet(snapshot: HomeTwinSnapshot): RoutePlanResult {
  const bed = snapshot.objects.find(o => o.category === 'bed');
  const toilet = snapshot.objects.find(o => o.category === 'toilet');
  if (!bed || !toilet) {
    return {
      status: 'unavailable',
      route: null,
      reason: '需要同时识别床和卫生间目标。',
      fallback: buildFallback(toilet ?? bed, snapshot.rooms, [
        '目前无法生成 3D 路线，先参考上次已知位置。',
        '如需帮助，可以让系统请家人确认。'
      ])
    };
  }

  const eligibility = assessRouteEligibility(snapshot);
  if (!eligibility.eligible) return {
    status: 'needs_confirmation', route: null, reason: eligibility.reason,
    fallback: buildFallback(toilet, snapshot.rooms, ['请参考已知文字位置，并让家人确认；不能把演示或低置信度数据当作可通行路线。'])
  };

  const objectById = new Map(snapshot.objects.map(o => [o.id, o]));
  const blocked = new Set(
    snapshot.relations
      .filter(r => r.relation === 'blocks')
      .map(r => r.subjectId)
  );

  const graph = new Map<string, Array<{ id: string; weight: number }>>();
  for (const object of snapshot.objects) graph.set(object.id, []);
  for (const relation of snapshot.relations.filter(usableRelation)) {
    if (!objectById.has(relation.subjectId) || !objectById.has(relation.objectId)) continue;
    if (blocked.has(relation.subjectId) || blocked.has(relation.objectId)) continue;
    const a = objectById.get(relation.subjectId)!;
    const b = objectById.get(relation.objectId)!;
    const weight = distance(a, b) / Math.max(relation.confidence, 0.1);
    graph.get(a.id)!.push({ id: b.id, weight });
    graph.get(b.id)!.push({ id: a.id, weight });
  }

  // The endpoints are valid nodes even if they have no explicit edge yet.
  if (!graph.has(bed.id) || !graph.has(toilet.id)) {
    return {
      status: 'needs_confirmation',
      route: null,
      reason: 'Home Twin 图结构不完整。',
      fallback: buildFallback(toilet, snapshot.rooms, ['请让家人补充空间信息后再使用路线。'])
    };
  }

  const dist = new Map<string, number>(snapshot.objects.map(o => [o.id, Infinity]));
  const prev = new Map<string, string>();
  const unvisited = new Set(graph.keys());
  dist.set(bed.id, 0);

  while (unvisited.size) {
    let current: string | null = null;
    let best = Infinity;
    for (const id of unvisited) {
      const d = dist.get(id)!;
      if (d < best) {
        best = d;
        current = id;
      }
    }
    if (!current || !Number.isFinite(best)) break;
    unvisited.delete(current);
    if (current === toilet.id) break;

    for (const edge of graph.get(current) ?? []) {
      if (!unvisited.has(edge.id)) continue;
      const next = best + edge.weight;
      if (next < dist.get(edge.id)!) {
        dist.set(edge.id, next);
        prev.set(edge.id, current);
      }
    }
  }

  if (!Number.isFinite(dist.get(toilet.id)!)) {
    return {
      status: 'needs_confirmation',
      route: null,
      reason: '没有足够空间关系可形成床到卫生间的可解释路线。',
      fallback: buildFallback(toilet, snapshot.rooms, [
        '床到卫生间之间的门/连接关系还不完整，暂不能给出可靠路线。',
        '可以先按上次已知位置前往，注意走廊光线和脚下障碍。',
        '需要时可以让系统请家人确认这条路线。'
      ])
    };
  }

  const objectIds: string[] = [];
  let cursor = toilet.id;
  while (true) {
    objectIds.push(cursor);
    if (cursor === bed.id) break;
    const parent = prev.get(cursor);
    if (!parent) {
      return {
        status: 'unavailable',
        route: null,
        reason: '路线回溯失败。',
        fallback: buildFallback(toilet, snapshot.rooms, ['请参考上次已知位置，或让家人确认。'])
      };
    }
    cursor = parent;
  }
  objectIds.reverse();

  const hazardIds = snapshot.relations
    .filter(r => r.relation === 'on-route' && objectIds.includes(r.objectId))
    .map(r => r.subjectId)
    .filter(id => objectById.has(id));

  const route: HomeRoute = {
    id: 'bed-to-toilet',
    title: '床 → 卫生间',
    startObjectId: bed.id,
    endObjectId: toilet.id,
    objectIds,
    hazardIds: [...new Set(hazardIds)],
    confidence: Math.min(
      bed.confidence,
      toilet.confidence,
      ...snapshot.relations
        .filter(r => usableRelation(r) && objectIds.includes(r.subjectId) && objectIds.includes(r.objectId))
        .map(r => r.confidence)
    ),
    source: 'inferred'
  };

  // 只有已有人工确认记录的预置路线才算 verified；图推导出来的始终是 candidate。
  // Demo 数据不能把路线升级成 verified；只有真实来源且明确标记为 verified 才能算已确认。
  const preConfirmed = snapshot.routes.find(r =>
    r.startObjectId === bed.id &&
    r.endObjectId === toilet.id &&
    r.objectIds.length === objectIds.length && r.objectIds.every((id, index) => id === objectIds[index]) &&
    r.status === 'verified' &&
    r.source !== 'demo'
  );
  const hasDoorOnPath = objectIds.some(id => objectById.get(id)?.category === 'door');

  if (!hasDoorOnPath) {
    return {
      status: 'needs_confirmation',
      route,
      reason: '路线上缺少已识别的门，无法确认房间之间的通行关系。',
      fallback: buildFallback(toilet, snapshot.rooms, [
        '这条候选路线没有经过已确认的门，请先参考上次已知位置。',
        '建议让家人确认门的位置后再使用路线。'
      ])
    };
  }

  if (preConfirmed) {
    route.status = 'verified';
    route.lastConfirmedAt = preConfirmed.lastConfirmedAt;
    return { status: 'verified', route };
  }

  route.status = 'candidate';
  return {
    status: 'candidate',
    route,
    fallback: buildFallback(toilet, snapshot.rooms, [
      '这是根据现有空间关系推导的候选路线，不是安全保证。',
      '夜间前往时请注意走廊光线和脚下障碍。'
    ])
  };
}
