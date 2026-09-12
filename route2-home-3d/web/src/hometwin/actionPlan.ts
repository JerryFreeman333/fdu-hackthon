export type HomeActionStatus = 'open' | 'in_progress' | 'completed' | 'resolved';

export interface HomePlanProvenance {
  homeId: string;
  homeVersion: number;
  riskRuleVersion: string;
  captureId: string;
  reconstructionId: string;
}

function parseProvenance(value: unknown): HomePlanProvenance | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (!['homeId', 'riskRuleVersion', 'captureId', 'reconstructionId'].every(
    key => typeof p[key] === 'string' && (p[key] as string).trim().length > 0
  ) || !Number.isInteger(p.homeVersion) || (p.homeVersion as number) < 1) return null;
  return {
    homeId: p.homeId as string, homeVersion: p.homeVersion as number,
    riskRuleVersion: p.riskRuleVersion as string, captureId: p.captureId as string,
    reconstructionId: p.reconstructionId as string,
  };
}

export function sameProvenance(a: HomePlanProvenance, b: HomePlanProvenance): boolean {
  return a.homeId === b.homeId && a.homeVersion === b.homeVersion &&
    a.riskRuleVersion === b.riskRuleVersion && a.captureId === b.captureId &&
    a.reconstructionId === b.reconstructionId;
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
  provenance?: HomePlanProvenance;
  resolvedAtProvenance?: HomePlanProvenance;
}

export interface HomeSafetyActionPlan {
  schemaVersion: 1;
  type: 'person-home-action-plan';
  status: 'open' | 'clear';
  privacyScope: 'private' | 'family_ok';
  actions: HomeSafetyAction[];
  principle?: string;
  provenance?: { current: HomePlanProvenance; previous: HomePlanProvenance | null };
}

export function parseHomeSafetyActionPlan(input: unknown): HomeSafetyActionPlan | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== 1 || value.type !== 'person-home-action-plan') return null;
  if (value.privacyScope !== 'private' && value.privacyScope !== 'family_ok') return null;
  if (value.status !== 'open' && value.status !== 'clear') return null;
  if (!Array.isArray(value.actions)) return null;
  const lineage = value.provenance as Record<string, unknown> | undefined;
  const current = lineage ? parseProvenance(lineage.current) : null;
  const previous = lineage?.previous == null ? null : parseProvenance(lineage.previous);
  if (lineage && (!current || lineage.previous === undefined ||
    (lineage.previous !== null && !previous))) return null;

  const actions: HomeSafetyAction[] = [];
  for (const raw of value.actions) {
    if (!raw || typeof raw !== 'object') return null;
    const a = raw as Record<string, unknown>;
    const closure = a.closureRule;
    if (!closure || typeof closure !== 'object') return null;
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
      typeof c.riskId !== 'string' || c.riskId !== a.riskId ||
      actions.some(action => action.id === a.id || action.riskId === a.riskId)
    ) {
      return null;
    }
    const source = a.provenance === undefined ? null : parseProvenance(a.provenance);
    const resolvedAt = a.resolvedAtProvenance === undefined ? null : parseProvenance(a.resolvedAtProvenance);
    if ((a.provenance !== undefined && !source) || (a.resolvedAtProvenance !== undefined && !resolvedAt)) return null;
    if (a.status === 'resolved' && (!current || !resolvedAt || !sameProvenance(current, resolvedAt))) return null;
    actions.push({
      id: a.id,
      riskId: a.riskId,
      kind: a.kind,
      title: a.title,
      description: a.description,
      status: a.status as HomeActionStatus,
      requiresRescan: a.requiresRescan,
      closureRule: { type: 'risk-disappears-after-rescan', riskId: c.riskId },
      provenance: source ?? undefined,
      resolvedAtProvenance: resolvedAt ?? undefined,
    });
  }

  // A malformed/partially dropped plan must never look like a clear household.
  if ((value.status === 'clear') !== actions.every(action => action.status === 'resolved')) return null;
  return {
    schemaVersion: 1,
    type: 'person-home-action-plan',
    status: value.status,
    privacyScope: value.privacyScope,
    actions,
    principle: typeof value.principle === 'string' ? value.principle : undefined,
    provenance: current ? { current, previous } : undefined,
  };
}

export function acceptRescanActionPlan(
  baseline: HomeSafetyActionPlan, candidate: HomeSafetyActionPlan,
): { accepted: true } | { accepted: false; reason: string } {
  const previous = baseline.provenance?.current;
  const current = candidate.provenance?.current;
  if (!parseHomeSafetyActionPlan(candidate)) return { accepted: false, reason: '复扫行动计划格式或关闭证据无效' };
  if (!previous || !current) return { accepted: false, reason: '缺少家庭采集与重建来源，不能自动关闭风险' };
  if (current.homeId !== previous.homeId || current.riskRuleVersion !== previous.riskRuleVersion)
    return { accepted: false, reason: '复扫家庭或风险规则不一致' };
  if (current.homeVersion <= previous.homeVersion || current.captureId === previous.captureId ||
    current.reconstructionId === previous.reconstructionId)
    return { accepted: false, reason: '复扫不是新一轮采集和重建，拒绝旧结果重放' };
  if (!candidate.provenance?.previous || !sameProvenance(candidate.provenance.previous, previous))
    return { accepted: false, reason: '复扫基线已过期，与当前家庭版本不一致' };
  for (const action of baseline.actions) {
    if (!candidate.actions.some(next => next.id === action.id && next.riskId === action.riskId))
      return { accepted: false, reason: '复扫丢失了历史行动，不能把缺失当作风险消失' };
  }
  return { accepted: true };
}
