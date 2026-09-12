import { parseHomeSafetyActionPlan, type HomeSafetyActionPlan } from './actionPlan';

export interface RescanResult {
  schemaVersion: 1;
  type: 'home-twin-rescan-result';
  status: 'ready' | 'processing' | 'failed';
  jobId?: string;
  scene?: string;
  latestRiskIds?: string[];
  actionPlan?: HomeSafetyActionPlan;
  message?: string;
}

export function parseRescanResult(input: unknown): RescanResult | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== 1 || value.type !== 'home-twin-rescan-result') return null;
  if (!['ready', 'processing', 'failed'].includes(String(value.status))) return null;
  const actionPlan = value.actionPlan === undefined ? null : parseHomeSafetyActionPlan(value.actionPlan);
  if (value.actionPlan !== undefined && (!actionPlan || value.status !== 'ready')) return null;
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
    message: typeof value.message === 'string' ? value.message : undefined,
  };
}
