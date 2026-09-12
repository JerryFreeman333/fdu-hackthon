import type { HealthKitBridgeDiagnostics } from '../adapters/HealthKitDeviceAdapter';

export const HEALTHKIT_POLL_INTERVAL_MS = 7_000;

export function shouldPollHealthKit(mode: 'demo' | 'healthkit'): boolean {
  return mode === 'healthkit';
}

export function healthKitRevisionKey(diagnostics: HealthKitBridgeDiagnostics | undefined): string | undefined {
  if (!diagnostics || diagnostics.freshness !== 'fresh') return undefined;
  const revision = diagnostics.revision;
  const receivedAt = diagnostics.receivedAt;
  if (revision === undefined && !receivedAt) return undefined;
  return `${revision ?? 'legacy'}:${receivedAt ?? 'unknown'}`;
}

export function shouldRefreshHealthKit(
  lastAppliedKey: string | undefined,
  diagnostics: HealthKitBridgeDiagnostics | undefined,
): boolean {
  const nextKey = healthKitRevisionKey(diagnostics);
  return nextKey !== undefined && nextKey !== lastAppliedKey;
}
