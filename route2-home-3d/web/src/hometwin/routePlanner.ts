import type { HomeObject, HomeRoute, HomeTwinSnapshot } from './model';

export interface RoutePlanResult {
  route: HomeRoute | null;
  reason?: string;
}

function distance(a: HomeObject, b: HomeObject): number {
  return Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z);
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
  if (!bed || !toilet) return { route: null, reason: '需要同时识别床和卫生间目标。' };

  const objectById = new Map(snapshot.objects.map(o => [o.id, o]));
  const blocked = new Set(
    snapshot.relations
      .filter(r => r.relation === 'blocks')
      .map(r => r.subjectId)
  );

  const graph = new Map<string, Array<{ id: string; weight: number }>>();
  for (const object of snapshot.objects) graph.set(object.id, []);
  for (const relation of snapshot.relations.filter(r => r.relation === 'connects')) {
    if (!objectById.has(relation.subjectId) || !objectById.has(relation.objectId)) continue;
    if (blocked.has(relation.subjectId) || blocked.has(relation.objectId)) continue;
    const a = objectById.get(relation.subjectId)!;
    const b = objectById.get(relation.objectId)!;
    const weight = distance(a, b) / Math.max(relation.confidence, 0.1);
    graph.get(a.id)!.push({ id: b.id, weight });
    graph.get(b.id)!.push({ id: a.id, weight });
  }

  // The endpoints are valid nodes even if they have no explicit edge yet.
  if (!graph.has(bed.id) || !graph.has(toilet.id)) return { route: null, reason: 'Home Twin 图结构不完整。' };

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

  if (!Number.isFinite(dist.get(toilet.id)!)) return { route: null, reason: '没有足够空间关系可形成床到卫生间的可解释路线。' };

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
        .filter(r => r.relation === 'connects' && objectIds.includes(r.subjectId) && objectIds.includes(r.objectId))
        .map(r => r.confidence)
    ),
    source: 'inferred'
  };

  return { route };
}
