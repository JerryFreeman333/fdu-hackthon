import type { CareTask, FamilyLink, FamilySharing, Finding } from '../types';
import type { HealthEvent } from '../pipeline/events';

export function familyEvents(events: HealthEvent[], sharing: FamilySharing, link: FamilyLink | null): HealthEvent[] {
  if (link?.status !== 'active') return [];
  return events.filter((event) => {
    const value =
      event.type === 'measurement'
        ? event.measurement
        : event.type === 'observation'
          ? event.observation
          : event.labResult;
    return (
      value.visibility === 'family_ok' &&
      (sharing === 'granted' || (event.type === 'observation' && event.sharedOnce === true))
    );
  });
}

export function familyTasks(
  tasks: CareTask[],
  findings: Finding[],
  sharing: FamilySharing,
  link: FamilyLink | null,
): CareTask[] {
  if (sharing !== 'granted' || link?.status !== 'active') return [];
  return tasks.filter(
    (task) =>
      task.visibility === 'family_ok' &&
      (!task.sourceFindingId ||
        findings.find((finding) => finding.id === task.sourceFindingId)?.familyEligible !== false),
  );
}

/** Explicit per-record permission; never changes other historical records. */
export function shareObservation(
  events: HealthEvent[],
  id: string,
  _sharing: FamilySharing,
  link: FamilyLink | null,
): HealthEvent[] {
  if (link?.status !== 'active') return events;
  return events.map((event) =>
    event.type === 'observation' && event.observation.id === id
      ? { ...event, sharedOnce: true, observation: { ...event.observation, visibility: 'family_ok' } }
      : event,
  );
}
