import { HomePlanProvenance, HomeSafetyActionPlan, parseHomeSafetyActionPlan, sameProvenance } from './actionPlan';

export interface RescanResult {
  schemaVersion: 1;
  type: 'home-twin-rescan-result';
  status: 'queued' | 'processing' | 'completed' | 'failed';
  jobId?: string;
  scene?: string;
  latestRiskIds?: string[];
  actionPlan?: HomeSafetyActionPlan;
  provenance?: { current: HomePlanProvenance; previous: HomePlanProvenance | null };
  message?: string;
}

function parseTopLevelProvenance(value: unknown): RescanResult['provenance'] | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') return undefined;
  const synthetic = {
    schemaVersion: 1,
    type: 'person-home-action-plan',
    status: 'open',
    privacyScope: 'local-device',
    actions: [],
    provenance: value,
  };
  const parsed = parseHomeSafetyActionPlan(synthetic);
  return parsed?.provenance;
}

function provenanceMatches(
  a: RescanResult['provenance'],
  b: RescanResult['provenance'],
): boolean {
  if (!a || !b) return false;
  if (!sameProvenance(a.current, b.current)) return false;
  if (a.previous === null || b.previous === null) return a.previous === b.previous;
  return sameProvenance(a.previous, b.previous);
}

export function parseRescanResult(value: unknown): RescanResult | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1 || raw.type !== 'home-twin-rescan-result' ||
      !['queued', 'processing', 'completed', 'failed'].includes(raw.status as string)) return null;

  const parsedActionPlan = raw.actionPlan !== undefined ? parseHomeSafetyActionPlan(raw.actionPlan) : undefined;
  if (raw.actionPlan !== undefined && !parsedActionPlan) return null;
  const actionPlan: HomeSafetyActionPlan | undefined = parsedActionPlan ?? undefined;

  const topLevelProvenance = parseTopLevelProvenance(raw.provenance);
  if (raw.provenance !== undefined && !topLevelProvenance) return null;
  if (actionPlan?.provenance && topLevelProvenance && !provenanceMatches(actionPlan.provenance, topLevelProvenance)) return null;

  return {
    schemaVersion: 1,
    type: 'home-twin-rescan-result',
    status: raw.status as RescanResult['status'],
    jobId: typeof raw.jobId === 'string' ? raw.jobId : undefined,
    scene: typeof raw.scene === 'string' ? raw.scene : undefined,
    latestRiskIds: Array.isArray(raw.latestRiskIds)
      ? raw.latestRiskIds.filter((id): id is string => typeof id === 'string')
      : undefined,
    actionPlan,
    provenance: topLevelProvenance,
    message: typeof raw.message === 'string' ? raw.message : undefined,
  };
}
