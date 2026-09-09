import { parseHomeSafetyActionPlan, type HomePlanProvenance, type HomeSafetyActionPlan } from './actionPlan';

export interface RescanResult {
  schemaVersion: 1;
  type: 'home-twin-rescan-result';
  status: 'ready' | 'processing' | 'failed';
  jobId?: string;
  scene?: string;
  latestRiskIds?: string[];
  actionPlan?: HomeSafetyActionPlan;
  provenance?: { current: HomePlanProvenance; previous: HomePlanProvenance | null };
  message?: string;
}

function parseTopLevelProvenance(input: unknown): RescanResult['provenance'] | undefined | null {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  const current = value.current;
  const previous = value.previous;
  const currentPlan = parseHomeSafetyActionPlan({
    schemaVersion: 1,
    type: 'person-home-action-plan',
    status: 'open',
    privacyScope: 'family_ok',
    actions: [],
    provenance: { current, previous },
  });
  return currentPlan?.provenance;
}

function provenanceMatches(
  a: RescanResult['provenance'],
  b: RescanResult['provenance'],
): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function parseRescanResult(input: unknown): RescanResult | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== 1 || value.type !== 'home-twin-rescan-result') return null;
  if (!['ready', 'processing', 'failed'].includes(String(value.status))) return null;

  const rawActionPlan = value.actionPlan;
  const actionPlan = rawActionPlan === undefined ? undefined : parseHomeSafetyActionPlan(rawActionPlan);
  if (rawActionPlan !== undefined && !actionPlan) return null;

  const topLevelProvenance = parseTopLevelProvenance(value.provenance);
  if (value.provenance !== undefined && !topLevelProvenance) return null;
  if (actionPlan?.provenance && topLevelProvenance && !provenanceMatches(actionPlan.provenance, topLevelProvenance)) return null;

  return {
    schemaVersion: 1,
    type: 'home-twin-rescan-result',
    status: value.status as RescanResult['status'],
    jobId: typeof value.jobId === 'string' ? value.jobId : undefined,
    scene: typeof value.scene === 'string' ? value.scene : undefined,
    latestRiskIds: Array.isArray(value.latestRiskIds)
      ? value.latestRiskIds.filter((id): id is string => typeof id === 'string')
      : undefined,
    actionPlan: actionPlan ?? undefined,
    provenance: topLevelProvenance,
    message: typeof value.message === 'string' ? value.message : undefined,
  };
}
