export interface HomeSafetyAction {
  id: string;
  riskId: string;
  kind: 'safety_check' | 'observation';
  title: string;
  description: string;
  requiresRescan: boolean;
  closureRule: {
    type: 'risk-disappears-after-rescan';
    riskId: string;
  };
  status: 'open' | 'in_progress' | 'resolved' | 'completed';
}

export function parseHomeSafetyActions(input: unknown): HomeSafetyAction[] {
  if (!input || typeof input !== 'object') return [];
  const actions = (input as { actions?: unknown }).actions;
  if (!Array.isArray(actions)) return [];

  return actions.flatMap((item): HomeSafetyAction[] => {
    if (!item || typeof item !== 'object') return [];
    const value = item as Record<string, unknown>;
    const closureRule = value.closureRule;
    if (!closureRule || typeof closureRule !== 'object') return [];
    const closure = closureRule as Record<string, unknown>;

    if (
      typeof value.id !== 'string' ||
      typeof value.riskId !== 'string' ||
      (value.kind !== 'safety_check' && value.kind !== 'observation') ||
      typeof value.title !== 'string' ||
      typeof value.description !== 'string' ||
      typeof value.requiresRescan !== 'boolean' ||
      closure.type !== 'risk-disappears-after-rescan' ||
      closure.riskId !== value.riskId ||
      !['open', 'in_progress', 'resolved', 'completed'].includes(String(value.status))
    ) {
      return [];
    }

    return [
      {
        id: value.id,
        riskId: value.riskId,
        kind: value.kind,
        title: value.title,
        description: value.description,
        requiresRescan: value.requiresRescan,
        closureRule: {
          type: 'risk-disappears-after-rescan',
          riskId: value.riskId,
        },
        status: value.status as HomeSafetyAction['status'],
      },
    ];
  });
}
