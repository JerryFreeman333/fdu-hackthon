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
  kind: 'safety_check' | 'observation';
  title: string;
  description: string;
  status: HomeActionStatus;
  requiresRescan: boolean;
  closureRule: { type: 'risk-disappears-after-rescan'; riskId: string };
  provenance?: HomePlanProvenance & { riskId: string };
  resolvedAtProvenance?: HomePlanProvenance & { riskId: string };
}

export interface HomeSafetyActionPlan {
  schemaVersion: 1;
  type: 'person-home-action-plan';
  status: 'open' | 'clear';
  privacyScope: 'private' | 'family_ok';
  actions: HomeSafetyAction[];
  provenance?: { current: HomePlanProvenance; previous: HomePlanProvenance | null };
  principle?: string;
}

function parseProvenance(input: unknown): HomePlanProvenance | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  const homeId = value.homeId;
  const homeVersion = value.homeVersion;
  const riskRuleVersion = value.riskRuleVersion;
  const captureId = value.captureId;
  const reconstructionId = value.reconstructionId;
  if (
    typeof homeId !== 'string' ||
    !homeId.trim() ||
    typeof homeVersion !== 'number' ||
    !Number.isInteger(homeVersion) ||
    homeVersion < 1 ||
    typeof riskRuleVersion !== 'string' ||
    !riskRuleVersion.trim() ||
    typeof captureId !== 'string' ||
    !captureId.trim() ||
    typeof reconstructionId !== 'string' ||
    !reconstructionId.trim()
  ) {
    return null;
  }
  return {
    homeId,
    homeVersion,
    riskRuleVersion,
    projectionAsOf: typeof value.projectionAsOf === 'string' ? value.projectionAsOf : undefined,
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : undefined,
    captureId,
    reconstructionId,
  };
}

function sameProvenance(a: HomePlanProvenance, b: HomePlanProvenance): boolean {
  return (
    a.homeId === b.homeId &&
    a.homeVersion === b.homeVersion &&
    a.riskRuleVersion === b.riskRuleVersion &&
    a.captureId === b.captureId &&
    a.reconstructionId === b.reconstructionId
  );
}

export function parseHomeSafetyActionPlan(input: unknown): HomeSafetyActionPlan | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== 1 || value.type !== 'person-home-action-plan') return null;
  if (value.privacyScope !== 'private' && value.privacyScope !== 'family_ok') return null;
  if (value.status !== 'open' && value.status !== 'clear') return null;
  if (!Array.isArray(value.actions)) return null;

  let planProvenance: HomeSafetyActionPlan['provenance'] = undefined;
  const rawPlanProvenance = value.provenance;
  if (rawPlanProvenance !== undefined) {
    if (!rawPlanProvenance || typeof rawPlanProvenance !== 'object') return null;
    const p = rawPlanProvenance as Record<string, unknown>;
    const current = parseProvenance(p.current);
    const previous = p.previous === null ? null : parseProvenance(p.previous);
    if (!current || (p.previous !== null && !previous)) return null;
    planProvenance = { current, previous: previous ?? null };
  }

  const actions: HomeSafetyAction[] = [];
  for (const raw of value.actions) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Record<string, unknown>;
    const closure = a.closureRule;
    if (!closure || typeof closure !== 'object') continue;
    const c = closure as Record<string, unknown>;
    if (
      typeof a.id !== 'string' ||
      typeof a.riskId !== 'string' ||
      (a.kind !== 'safety_check' && a.kind !== 'observation') ||
      typeof a.title !== 'string' ||
      typeof a.description !== 'string' ||
      !['open', 'in_progress', 'completed', 'resolved'].includes(String(a.status)) ||
      typeof a.requiresRescan !== 'boolean' ||
      c.type !== 'risk-disappears-after-rescan' ||
      typeof c.riskId !== 'string' ||
      c.riskId !== a.riskId
    ) {
      continue;
    }

    const actionProvenance = a.provenance !== undefined ? parseProvenance(a.provenance) : null;
    const resolvedAtProvenance = a.resolvedAtProvenance !== undefined
      ? parseProvenance(a.resolvedAtProvenance)
      : null;
    const status = a.status as HomeActionStatus;

    if (status === 'resolved') {
      // A resolved rescan-dependent action is never accepted without a complete
      // resolution provenance chain. This blocks forged actionPlan.status values.
      if (!planProvenance?.current || !resolvedAtProvenance) continue;
      if (!sameProvenance(planProvenance.current, resolvedAtProvenance)) continue;
      if (resolvedAtProvenance.riskId !== a.riskId) continue;
    }

    if (actionProvenance && planProvenance?.current && !sameProvenance(actionProvenance, planProvenance.current)) {
      continue;
    }

    actions.push({
      id: a.id,
      riskId: a.riskId,
      kind: a.kind as HomeSafetyAction['kind'],
      title: a.title,
      description: a.description,
      status,
      requiresRescan: a.requiresRescan,
      closureRule: { type: 'risk-disappears-after-rescan', riskId: c.riskId },
      provenance: actionProvenance ? { ...actionProvenance, riskId: a.riskId } : undefined,
      resolvedAtProvenance: resolvedAtProvenance
        ? { ...resolvedAtProvenance, riskId: a.riskId }
        : undefined,
    });
  }

  // If a closure-capable plan contains malformed actions, silently dropping them
  // would make the UI believe the plan is complete. Fail closed instead.
  if (actions.length !== value.actions.length) return null;
  if (
    actions.some((action) => action.status === 'resolved' && action.requiresRescan) &&
    !planProvenance?.current
  ) {
    return null;
  }

  return {
    schemaVersion: 1,
    type: 'person-home-action-plan',
    status: value.status,
    privacyScope: value.privacyScope,
    actions,
    provenance: planProvenance,
    principle: typeof value.principle === 'string' ? value.principle : undefined,
  };
}
