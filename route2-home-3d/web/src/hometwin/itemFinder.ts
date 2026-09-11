import type { HomeObject, HomeObjectCategory, HomeTwinSnapshot } from './model';

/**
 * 找物品/找药的结果。刻意不依赖任何 3D 路线或拓扑：
 * 即使 Home Twin 没有可用的路线，也必须能回答"东西在哪"。
 */
export interface ItemLookupResult {
  status: 'found' | 'uncertain' | 'not_found';
  label: string;
  /** 面向老人的文字位置，例如"卧室床头柜上" */
  locationText?: string;
  roomLabel?: string;
  lastConfirmedAt?: string;
  confidence: number;
  evidenceImageIds: string[];
  /** 位置不确定时的明确提示 */
  note?: string;
}

export interface ItemLookupQuery {
  category?: HomeObjectCategory;
  /** 按标签模糊匹配，如"药"、"老花镜" */
  labelIncludes?: string;
}

const UNCERTAIN_CONFIDENCE = 0.5;

export function locateItem(snapshot: HomeTwinSnapshot, query: ItemLookupQuery): ItemLookupResult {
  const candidates = snapshot.objects.filter(object => {
    if (query.category && object.category !== query.category) return false;
    if (query.labelIncludes && !object.label.includes(query.labelIncludes)) return false;
    return true;
  });

  if (!candidates.length) {
    return {
      status: 'not_found',
      label: query.labelIncludes ?? query.category ?? '物品',
      confidence: 0,
      evidenceImageIds: [],
      note: '目前的空间记录里没有这个物品。可以让系统请家人帮忙确认位置。'
    };
  }

  // 置信度最高的优先；同置信度取最新观察的。
  const best = candidates.reduce((a, b) => (b.confidence > a.confidence ? b : a));
  const room = snapshot.rooms.find(r => r.id === best.roomId);
  const locationText = best.locationText ?? (room ? `在${room.label}内` : undefined);
  const lastConfirmedAt = best.lastConfirmedAt ?? best.observedAt;
  const evidenceImageIds = best.evidence?.imageIds ?? [];

  if (best.confidence < UNCERTAIN_CONFIDENCE || best.source === 'inferred') {
    return {
      status: 'uncertain',
      label: best.label,
      locationText,
      roomLabel: room?.label,
      lastConfirmedAt,
      confidence: best.confidence,
      evidenceImageIds,
      note: '这个位置是系统推测的，可能不准确。前往时请注意脚下，或让系统请家人确认。'
    };
  }

  return {
    status: 'found',
    label: best.label,
    locationText,
    roomLabel: room?.label,
    lastConfirmedAt,
    confidence: best.confidence,
    evidenceImageIds,
    note: evidenceImageIds.length ? undefined : '没有留存照片证据，位置来自登记记录。'
  };
}
