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
  if (
    typeof value.homeId !== 'string' ||
    !value.homeId.trim() ||
    !Number.isInteger(value.homeVersion) ||
    value.homeVersion < 1 ||
    typeof value.riskRuleVersion !== 'string' ||
    !value.riskRuleVersion.trim() ||
    typeof value.captureId !== 'string' ||
    !value.captureId.trim() ||
    typeof value.reconstructionId !== 'string' ||
    !value.reconstructionId.trim()
  ) {
    return null;
  }
  return {
    homeId: value.homeId,
    homeVersion: value.homeVersion,
    riskRuleVersion: value.riskRuleVersion,
    projectionAsOf: typeof value.projectionAsOf === 'string' ? value.projectionAsOf : undefined,
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : undefined,
    captureId: value.captureId,
    reconstructionId: value.reconstructionId,
  };
}

export function parseHomeSafetyActionPlan(input: unknown): HomeSafetyActionPlan | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== 1 || value.type !== 'person-home-action-plan') return null;
  if (value.privacyScope !== 'private' && value.privacyScope !== 'family_ok') return null;
  if (value.status !== 'open' && value.status !== 'clear') return null;
  if (!Array.isArray(value.actions)) return null;

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
      typeof c.riskId !== 'string'
    ) {
      continue;
    }
    const actionProvenance = a.provenance ? parseProvenance(a.provenance) : null;
    actions.push({
      id: a.id,
      riskId: a.riskId,
      kind: a.kind as HomeSafetyAction['kind'],
      title: a.title,
      description: a.description,
      status: a.status as HomeActionStatus,
      requiresRescan: a.requiresRescan,
      closureRule: { type: 'risk-disappears-after-rescan', riskId: c.riskId },
      provenance: actionProvenance ? { ...actionProvenance, riskId: a.riskId } : undefined,
    });
  }

  const rawPlanProvenance = value.provenance;
  let planProvenance: HomeSafetyActionPlan['provenance'] = undefined;
  if (rawPlanProvenance && typeof rawPlanProvenance === 'object') {
    const p = rawPlanProvenance as Record<string, unknown>;
    const current = parseProvenance(p.current);
    const previous = p.previous === null ? null : parseProvenance(p.previous);
    if (!current || (p.previous !== null && !previous)) return null;
    planProvenance = { current, previous: previous ?? null };
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

export function applyRescan(plan: HomeSafetyActionPlan, activeRiskIds: Iterable<string>): HomeSafetyActionPlan {
  if (!plan.provenance?.current) {
    throw new Error('复扫结果缺少完整 provenance，禁止自动关闭历史风险。');
  }
  const active = new Set(activeRiskIds);
  const actions = plan.actions.map((action) => {
    if (action.status === 'resolved') return action;
    if (action.requiresRescan && !active.has(action.riskId)) {
      return {
        ...action,
        status: 'resolved' as const,
        resolvedAtProvenance: { ...plan.provenance!.current, riskId: action.riskId },
      };
    }
    return action;
  });

  return {
    ...plan,
    status: actions.some((action) => action.status !== 'resolved') ? 'open' : 'clear',
  };
}
