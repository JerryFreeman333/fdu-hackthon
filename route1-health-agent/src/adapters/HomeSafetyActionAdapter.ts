export interface HomeSafetyAction {
  id: string;
  riskId: string;
  title: string;
  description: string;
  action: string;
  requiresRescan: boolean;
  closureRule: string;
  status: 'open' | 'done' | 'resolved';
  source: 'route2-person-home-risk';
}

export function parseHomeSafetyActions(input: unknown): HomeSafetyAction[] {
  if (!input || typeof input !== 'object') return [];
  const actions = (input as { actions?: unknown }).actions;
  if (!Array.isArray(actions)) return [];

  return actions.filter((item): item is HomeSafetyAction => {
    if (!item || typeof item !== 'object') return false;
    const value = item as Record<string, unknown>;
    return (
      typeof value.id === 'string' &&
      typeof value.riskId === 'string' &&
      typeof value.title === 'string' &&
      typeof value.description === 'string' &&
      typeof value.action === 'string' &&
      typeof value.requiresRescan === 'boolean' &&
      typeof value.closureRule === 'string' &&
      (value.status === 'open' || value.status === 'done' || value.status === 'resolved') &&
      value.source === 'route2-person-home-risk'
    );
  });
}
