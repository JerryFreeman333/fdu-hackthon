import type { FamilyHealthEvent, FamilySharing } from '../types';

/** Family events stay outside the elder HealthEvent stream and are filtered at presentation time. */
export function visibleFamilyEvents(
  events: FamilyHealthEvent[],
  familySharing: FamilySharing,
  sharedFamilyEventIds: string[] = [],
): FamilyHealthEvent[] {
  const oneTimeShared = new Set(sharedFamilyEventIds);
  return events.filter(
    (event) => event.visibility !== 'private' && (familySharing === 'granted' || oneTimeShared.has(event.id)),
  );
}

export function familySubjectLabel(subject: FamilyHealthEvent['subject']): string {
  switch (subject) {
    case 'spouse':
      return '配偶';
    case 'father':
      return '父亲';
    case 'mother':
      return '母亲';
    default:
      return '家人';
  }
}

export function familyStatusLabel(status: FamilyHealthEvent['status']): string {
  switch (status) {
    case 'occurred':
      return '已发生';
    case 'negated':
      return '未发现';
    case 'uncertain':
      return '待确认';
    default:
      return '仅作参考';
  }
}
