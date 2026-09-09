import type { HomeObject, HomeRoute, HomeTwinSnapshot } from './model';

export interface RoutePlanResult {
  route: HomeRoute | null;
  reason?: string;
}

export interface RouteEligibility {
  eligible: boolean;
  reason?: string;
}

const MIN_ENDPOINT_CONFIDENCE = 0.6;
const MIN_RELATION_CONFIDENCE = 0.6;
const MIN_ROUTE_CONFIDENCE = 0.6;
const ALLOWED_ROUTE_RELATION_SOURCES = new Set(['vision', 'manual', 'inferred']);

function distance(a: HomeObject, b: HomeObject): number {
  return Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z);
}

function findUnique(snapshot: HomeTwinSnapshot, category: HomeObject['category']): HomeObject | null {
  const matches = snapshot.objects.filter((object) => object.category === category);
  return matches.length === 1 ? matches[0] : null;
}

function usableRelation(relation: HomeTwinSnapshot['relations'][number]): boolean {
  return relation.relation === 'connects' &&
    relation.confidence >= MIN_RELATION_CONFIDENCE &&
    ALLOWED_ROUTE_RELATION_SOURCES.has(relation.source);
}

export function assessRouteEligibility(snapshot: HomeTwinSnapshot): RouteEligibility {
  const beds = snapshot.objects.filter((object) => object.category === 'bed');
  const toilets = snapshot.objects.filter((object) => object.category === 'toilet');
  if (beds.length !== 1 || toilets.length !== 1) {
    return { eligible: false, reason: '无法唯一确定床和卫生间目标，暂不生成路线。' };
  }

  const bed = beds[0];
  const toilet = toilets[0];
  if (bed.confidence < MIN_ENDPOINT_CONFIDENCE || toilet.confidence < MIN_ENDPOINT_CONFIDENCE) {
    return { eligible: false, reason: '床或卫生间识别置信度不足，暂不生成路线。' };
  }

  const blocked = new Set(
    snapshot.relations
      .filter((relation) => relation.relation === 'blocks')
      .map((relation) => relation.subjectId),
  );
  if (blocked.has(bed.id) || blocked.has(toilet.id)) {
    return { eligible: false, reason: '路线端点存在阻断证据，暂不生成路线。' };
  }

  const connectingRelations = snapshot.relations.filter(
    (relation) => usableRelation(relation) && !blocked.has(relation.subjectId) && !blocked.has(relation.objectId),
  );
  if (connectingRelations.length === 0) {
    return { eligible: false, reason: '缺少足够可靠的空间连接证据，暂不生成路线。' };
  }

  return { eligible: true };
}

export function planBedToToilet(snapshot: HomeTwinSnapshot): RoutePlanResult {
  const eligibility = assessRouteEligibility(snapshot);
  if (!eligibility.eligible) return { route: null, reason: eligibility.reason };

  const bed = findUnique(snapshot, 'bed');
  const toilet = findUnique(snapshot, 'toilet');
  if (!bed || !toilet) return { route: null, reason: '需要同时唯一识别床和卫生间目标。' };

  const objectById = new Map(snapshot.objects.map((object) => [object.id, object]));
  const blocked = new Set(
    snapshot.relations.filter((relation) => relation.relation === 'blocks').map((relation) => relation.subjectId),
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

  const dist = new Map<string, number>(snapshot.objects.map((object) => [object.id, Infinity]));
  const prev = new Map<string, string>();
  const unvisited = new Set(graph.keys());
  dist.set(bed.id, 0);

  while (unvisited.size) {
    let current: string | null = null;
    let best = Infinity;
    for (const id of unvisited) {
      const value = dist.get(id)!;
      if (value < best) {
        best = value;
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
    return { route: null, reason: '没有足够空间关系可形成床到卫生间的可解释路线。' };
  }

  const objectIds: string[] = [];
  let cursor = toilet.id;
  while (true) {
    objectIds.push(cursor);
    if (cursor === bed.id) break;
    const parent = prev.get(cursor);
    if (!parent) return { route: null, reason: '路线回溯失败。' };
    cursor = parent;
  }
  objectIds.reverse();

  const routeRelations = objectIds.slice(0, -1).flatMap((id, index) => {
    const nextId = objectIds[index + 1];
    return snapshot.relations.filter(
      (relation) =>
        usableRelation(relation) &&
        ((relation.subjectId === id && relation.objectId === nextId) ||
          (relation.subjectId === nextId && relation.objectId === id)),
    );
  });
  const routeConfidence = Math.min(
    bed.confidence,
    toilet.confidence,
    ...routeRelations.map((relation) => relation.confidence),
  );
  if (!Number.isFinite(routeConfidence) || routeConfidence < MIN_ROUTE_CONFIDENCE) {
    return { route: null, reason: '路线整体证据置信度不足，暂不展示为可解释路线。' };
  }

  const hazardIds = snapshot.relations
    .filter((relation) => relation.relation === 'on-route' && objectIds.includes(relation.objectId))
    .map((relation) => relation.subjectId)
    .filter((id) => objectById.has(id));

  return {
    route: {
      id: 'bed-to-toilet',
      title: '床 → 卫生间',
      startObjectId: bed.id,
      endObjectId: toilet.id,
      objectIds,
      hazardIds: [...new Set(hazardIds)],
      confidence: routeConfidence,
      source: 'inferred',
    },
  };
}
