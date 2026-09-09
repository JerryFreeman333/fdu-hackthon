export type HomeActionStatus = 'open' | 'in_progress' | 'completed' | 'resolved';

export interface HomeSafetyAction {
  id: string;
  riskId: string;
  kind: 'safety_check' | 'observation';
  title: string;
  description: string;
  status: HomeActionStatus;
  requiresRescan: boolean;
  closureRule: { type: 'risk-disappears-after-rescan'; riskId: string };
}

export interface HomeSafetyActionPlan {
  schemaVersion: 1;
  type: 'person-home-action-plan';
  status: 'open' | 'clear';
  privacyScope: 'private' | 'family_ok';
  actions: HomeSafetyAction[];
  principle?: string;
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
    actions.push({
      id: a.id,
      riskId: a.riskId,
      kind: a.kind,
      title: a.title,
      description: a.description,
      status: a.status as HomeActionStatus,
      requiresRescan: a.requiresRescan,
      closureRule: { type: 'risk-disappears-after-rescan', riskId: c.riskId },
    });
  }

  return {
    schemaVersion: 1,
    type: 'person-home-action-plan',
    status: value.status,
    privacyScope: value.privacyScope,
    actions,
    principle: typeof value.principle === 'string' ? value.principle : undefined,
  };
}

export function applyRescan(plan: HomeSafetyActionPlan, activeRiskIds: Iterable<string>): HomeSafetyActionPlan {
  const active = new Set(activeRiskIds);
  const actions = plan.actions.map((action) => {
    if (action.status === 'completed' || action.status === 'resolved') return action;
    if (action.requiresRescan && !active.has(action.riskId)) {
      return { ...action, status: 'resolved' as const };
    }
    return action;
  });

  return {
    ...plan,
    status: actions.some((action) => action.status === 'open' || action.status === 'in_progress') ? 'open' : 'clear',
    actions,
  };
}
