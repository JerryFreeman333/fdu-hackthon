export type HomeActionStatus = 'open' | 'in_progress' | 'completed' | 'resolved';

export interface HomePlanProvenance {
  homeId: string;
  homeVersion: number;
  riskRuleVersion: string;
  projectionAsOf?: string;
  generatedAt?: string;
  captureId: string;
  reconstructionId: string;
}

export interface HomeSafetyAction {
  id: string;
  riskId: string;
  kind: 'observation' | 'manual_check' | 'reposition' | 'rescan';
  title: string;
  description: string;
  status: HomeActionStatus;
  requiresRescan: boolean;
  closureRule: { type: 'risk-disappears-after-rescan'; riskId: string };
  provenance?: HomePlanProvenance;
  resolvedAtProvenance?: HomePlanProvenance;
}

export interface HomeSafetyActionPlan {
  schemaVersion: 1;
  type: 'person-home-action-plan';
  status: 'open' | 'clear';
  privacyScope: 'local-device';
  actions: HomeSafetyAction[];
  provenance?: { current: HomePlanProvenance; previous: HomePlanProvenance | null };
}

function parseProvenance(value: unknown): HomePlanProvenance | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (
    typeof p.homeId !== 'string' ||
    typeof p.homeVersion !== 'number' || !Number.isInteger(p.homeVersion) || p.homeVersion < 0 ||
    typeof p.riskRuleVersion !== 'string' ||
    typeof p.captureId !== 'string' ||
    typeof p.reconstructionId !== 'string'
  ) return null;
  if (p.projectionAsOf !== undefined && typeof p.projectionAsOf !== 'string') return null;
  if (p.generatedAt !== undefined && typeof p.generatedAt !== 'string') return null;
  return {
    homeId: p.homeId,
    homeVersion: p.homeVersion,
    riskRuleVersion: p.riskRuleVersion,
    projectionAsOf: p.projectionAsOf as string | undefined,
    generatedAt: p.generatedAt as string | undefined,
    captureId: p.captureId,
    reconstructionId: p.reconstructionId,
  };
}

export function sameProvenance(a: HomePlanProvenance, b: HomePlanProvenance): boolean {
  return a.homeId === b.homeId &&
    a.homeVersion === b.homeVersion &&
    a.riskRuleVersion === b.riskRuleVersion &&
    a.captureId === b.captureId &&
    a.reconstructionId === b.reconstructionId;
}

export function parseHomeSafetyActionPlan(value: unknown): HomeSafetyActionPlan | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1 || raw.type !== 'person-home-action-plan' ||
      !['open', 'clear'].includes(raw.status as string) || raw.privacyScope !== 'local-device' ||
      !Array.isArray(raw.actions)) return null;

  const planProvenance = raw.provenance as Record<string, unknown> | undefined;
  const current = planProvenance ? parseProvenance(planProvenance.current) : null;
  const previous = planProvenance?.previous === null ? null : parseProvenance(planProvenance?.previous);
  if (planProvenance && (!current || planProvenance.previous === undefined || (planProvenance.previous !== null && !previous))) return null;

  const actions: HomeSafetyAction[] = [];
  for (const item of raw.actions) {
    if (!item || typeof item !== 'object') return null;
    const a = item as Record<string, unknown>;
    const c = a.closureRule as Record<string, unknown> | undefined;
    if (
      typeof a.id !== 'string' || typeof a.riskId !== 'string' ||
      typeof a.kind !== 'string' || typeof a.title !== 'string' || typeof a.description !== 'string' ||
      !['open', 'in_progress', 'completed', 'resolved'].includes(a.status as string) ||
      typeof a.requiresRescan !== 'boolean' ||
      c?.type !== 'risk-disappears-after-rescan' || typeof c.riskId !== 'string' ||
      c.riskId !== a.riskId
    ) return null;

    const actionProvenance = a.provenance !== undefined ? parseProvenance(a.provenance) : null;
    const resolvedAtProvenance = a.resolvedAtProvenance !== undefined
      ? parseProvenance(a.resolvedAtProvenance) : null;
    if ((a.provenance !== undefined && !actionProvenance) ||
        (a.resolvedAtProvenance !== undefined && !resolvedAtProvenance)) return null;
    const status = a.status as HomeActionStatus;

    if (status === 'resolved') {
      if (!planProvenance?.current || !resolvedAtProvenance) return null;
      if (!sameProvenance(planProvenance.current, resolvedAtProvenance)) return null;
    }
    if (actionProvenance && planProvenance?.current && !sameProvenance(actionProvenance, planProvenance.current)) return null;

    actions.push({
      id: a.id, riskId: a.riskId, kind: a.kind as HomeSafetyAction['kind'],
      title: a.title, description: a.description, status,
      requiresRescan: a.requiresRescan,
      closureRule: { type: 'risk-disappears-after-rescan', riskId: c.riskId },
      provenance: actionProvenance ?? undefined,
      resolvedAtProvenance: resolvedAtProvenance ?? undefined,
    });
  }
  if (actions.length !== raw.actions.length) return null;
  if (actions.some((action) => action.status === 'resolved' && action.requiresRescan) && !planProvenance?.current) return null;

  return {
    schemaVersion: 1, type: 'person-home-action-plan', status: raw.status as HomeSafetyActionPlan['status'],
    privacyScope: 'local-device', actions,
    provenance: current ? { current, previous } : undefined,
  };
}

export function acceptRescanActionPlan(
  previousPlan: HomeSafetyActionPlan,
  candidatePlan: HomeSafetyActionPlan,
): { accepted: true } | { accepted: false; reason: string } {
  const previous = previousPlan.provenance?.current;
  const candidate = candidatePlan.provenance?.current;
  if (!previous || !candidate) return { accepted: false, reason: 'missing snapshot provenance' };
  if (candidate.homeId !== previous.homeId) return { accepted: false, reason: 'home identity changed' };
  if (candidate.riskRuleVersion !== previous.riskRuleVersion) return { accepted: false, reason: 'risk rule version changed' };
  if (candidate.homeVersion <= previous.homeVersion) return { accepted: false, reason: 'candidate snapshot 不是更新版本' };
  if (candidate.captureId === previous.captureId) return { accepted: false, reason: 'capture did not change' };
  if (candidate.reconstructionId === previous.reconstructionId) return { accepted: false, reason: 'reconstruction did not change' };
  if (candidatePlan.provenance?.previous && !sameProvenance(candidatePlan.provenance.previous, previous)) {
    return { accepted: false, reason: 'candidate previous provenance does not match current snapshot' };
  }

  for (const action of candidatePlan.actions) {
    if (action.status !== 'resolved' || !action.requiresRescan) continue;
    if (!action.resolvedAtProvenance || !sameProvenance(action.resolvedAtProvenance, candidate)) {
      return { accepted: false, reason: `resolution provenance missing or stale for ${action.riskId}` };
    }
  }
  return { accepted: true };
}
