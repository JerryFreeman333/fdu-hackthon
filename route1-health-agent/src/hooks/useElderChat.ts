import type { Dispatch, SetStateAction } from 'react';
import type { ChatMessage, ElderProfile, ElderSubject, FamilyHealthEvent, Finding, HealthMeasurement } from '../types';
import { METRICS } from '../types';
import { TODAY } from '../data/demo';
import { appendHealthEvents, measurementToEvent, observationToEvent, type HealthEvent } from '../pipeline/events';
import { demoImageHealthParser, type DemoImageKind } from '../adapters/DemoImageHealthParser';
import {
  createHttpLlmAdapter,
  generateAgentReply,
  msg,
  QUICK_INPUTS,
  ruleBasedAdapter,
  tagLabel,
} from '../engine/agent';
import { extractHealthValues } from '../engine/extract';
import { canShareWithFamily, parsePrivacyIntent } from '../engine/privacy';
import { runDetection } from '../engine/detect';
import { buildFamilyAcknowledgement, buildSelfSharingAcknowledgement } from '../engine/userFacing';
import {
  buildHistoricalSharingAnswer,
  inferSharingRecipient,
  loadSharingAudit,
  recordSharingAudit,
} from '../engine/sharingAudit';
import {
  acceptedSelfClaims,
  hasDeathReport,
  understandElderInput,
  type StructuredElderInput,
} from '../engine/understanding';

const DEMO_ELDER_ID = 'demo-elder-route1';
const llmAdapter = import.meta.env.VITE_AGENT_LLM_ENDPOINT
  ? createHttpLlmAdapter(import.meta.env.VITE_AGENT_LLM_ENDPOINT)
  : ruleBasedAdapter;

type FamilySubject = Exclude<ElderSubject, 'self' | 'unknown'>;

interface UseElderChatOptions {
  familySharing: ElderProfile['familySharing'];
  events: HealthEvent[];
  chat: ChatMessage[];
  findings: Finding[];
  agentContext: Parameters<typeof generateAgentReply>[4];
  setEvents: Dispatch<SetStateAction<HealthEvent[]>>;
  setFamilyEvents: Dispatch<SetStateAction<FamilyHealthEvent[]>>;
  setChat: Dispatch<SetStateAction<ChatMessage[]>>;
  showToast: (text: string) => void;
  onMedicationMissed: (createdAt: string) => void;
  onShareFindingIds: (ids: string[]) => void;
  onShareFamilyEventIds: (ids: string[]) => void;
}

function localIsoTimestamp(): string {
  return new Date().toISOString();
}

function recallSummary(chat: ChatMessage[]): string {
  const prior = chat.filter((message) => message.role === 'elder').slice(-4);
  if (prior.length === 0) return '我这次对话里还没有找到您之前说的话。您可以再告诉我一次，我不会自己编造记忆。';
  return `我能看到这次对话里您之前说过：\n${prior.map((message) => `“${message.text}”`).join('\n')}`;
}

function sharingHistoryRequested(text: string): boolean {
  return /(?:有没有|刚才|之前|到底|究竟).*(?:告诉|说给|分享给).*(?:女儿|儿子|家属|孩子)?.*(?:什么|哪些|哪条)|(?:告诉|分享给).*(?:什么|哪些|哪条)/.test(
    text,
  );
}

function shouldPersistClaim(claim: StructuredElderInput['claims'][number]): boolean {
  return (
    claim.subject === 'self' &&
    claim.status === 'occurred' &&
    claim.eventDate !== null &&
    (claim.tags.length > 0 || claim.hasHealthValue)
  );
}

function isFamilySubject(subject: ElderSubject): subject is FamilySubject {
  return subject !== 'self' && subject !== 'unknown';
}

function shouldPersistFamilyClaim(
  claim: StructuredElderInput['claims'][number],
): claim is StructuredElderInput['claims'][number] & {
  subject: FamilySubject;
} {
  return (
    isFamilySubject(claim.subject) &&
    claim.status !== 'hypothetical' &&
    claim.eventDate !== null &&
    (claim.tags.length > 0 || claim.hasHealthValue)
  );
}

function removeLatestCorrectedChatEvents(events: HealthEvent[], priorTags: string[]): HealthEvent[] {
  if (priorTags.length === 0) return events;
  let removed = false;
  const next = [...events].reverse().filter((event) => {
    if (removed || event.source !== 'chat') return true;
    if (event.type === 'observation' && event.observation.tags.some((tag) => priorTags.includes(tag))) {
      removed = true;
      return false;
    }
    return true;
  });
  return next.reverse();
}

function removeLatestCorrectedFamilyEvents(
  events: FamilyHealthEvent[],
  priorTags: string[],
  priorFamilySubjects: FamilySubject[],
): FamilyHealthEvent[] {
  if (priorTags.length === 0 || priorFamilySubjects.length === 0) return events;
  const familySubjects = new Set(priorFamilySubjects);
  const index = [...events]
    .reverse()
    .findIndex((event) => familySubjects.has(event.subject) && event.tags.some((tag) => priorTags.includes(tag)));
  if (index === -1) return events;
  const actualIndex = events.length - 1 - index;
  return events.filter((_event, eventIndex) => eventIndex !== actualIndex);
}

function isCurrentReassurance(text: string): boolean {
  return /^(?:我)?(?:现在)?(?:感觉)?(?:没事|没什么事|没什么事情|还好|挺好的)[。！!,.，]*$/.test(text.trim());
}

export function useElderChat({
  familySharing,
  events,
  chat,
  findings,
  agentContext,
  setEvents,
  setFamilyEvents,
  setChat,
  showToast,
  onMedicationMissed,
  onShareFindingIds,
  onShareFamilyEventIds,
}: UseElderChatOptions) {
  async function handleElderSend(text: string) {
    const intent = parsePrivacyIntent(text);
    const sharingHistoryQuery = sharingHistoryRequested(text);
    const understanding = understandElderInput(text, TODAY, chat);
    const acceptedClaims = acceptedSelfClaims(understanding);
    const acceptedTags = [...new Set(acceptedClaims.flatMap((claim) => claim.tags))];
    const familyClaims = understanding.claims.filter(shouldPersistFamilyClaim);
    const familyOnlyClaims = understanding.claims.filter(
      (claim) =>
        claim.subject !== 'self' && claim.subject !== 'unknown' && (claim.tags.length > 0 || claim.hasHealthValue),
    );
    const canShare = canShareWithFamily(familySharing, intent);
    const visibility = canShare ? 'family_ok' : 'private';
    const shareMode = intent === 'share_family' ? 'one_time' : canShare ? 'persistent' : 'private';
    const now = `${TODAY.slice(5)} ${new Date().toTimeString().slice(0, 5)}`;
    const persisted = intent !== 'no_record';

    let agentText: string;
    if (sharingHistoryQuery) {
      const recipient = /女儿/.test(text) ? 'daughter' : /儿子/.test(text) ? 'son' : /家属|孩子/.test(text) ? 'family' : undefined;
      agentText = buildHistoricalSharingAnswer(loadSharingAudit(), recipient ?? inferSharingRecipient(text));
    } else if (understanding.recallRequested) {
      agentText = recallSummary(chat);
    } else if (understanding.clarificationQuestion) {
      agentText = understanding.clarificationQuestion;
    } else if (hasDeathReport(understanding)) {
      agentText =
        '我听见您在说一位家人的情况可能非常严重。它不是普通跌倒提醒，我先不把它记到您的健康档案。请您确认：这是已经确认发生的事情，还是您在担心可能出现这种情况？如果现场需要即时处理，请先联系当地专业急救或公安人员。';
    } else if (isCurrentReassurance(text)) {
      const unresolved = findings.find((finding) => finding.severity === 'urgent' || finding.severity === 'alert');
      agentText = unresolved
        ? '知道了，您现在感觉还好。我会把您的当前感受和之前的记录分开看；之前还有需要确认的事情，我会单独提醒您。'
        : '知道了，您现在感觉还好。今天有什么变化，随时告诉我就行。';
    } else if (acceptedTags.length === 0 && acceptedClaims.length === 0 && familyOnlyClaims.length > 0) {
      const familyLabels = [...new Set(familyOnlyClaims.flatMap((claim) => claim.tags))].map(tagLabel);
      const labelText = familyLabels.length > 0 ? `（我听到的是${familyLabels.join('、')}等家人的情况）` : '';
      agentText = `我明白，您刚才说的是家里人的情况${labelText}，不会记到您本人的健康档案里。需要继续处理时，可以告诉我具体是谁。`;
    } else if (acceptedTags.length === 0 && acceptedClaims.length === 0 && understanding.claims.length > 0) {
      agentText =
        '我先不把这句话记成您的健康事实。您可以告诉我：说的是您自己，还是家里其他人？事情已经发生了，还是只是想问问这种情况怎么办？';
    } else {
      const selectedAdapter = intent === 'private' || intent === 'no_record' ? ruleBasedAdapter : llmAdapter;
      agentText = await generateAgentReply(
        text,
        acceptedTags,
        findings,
        acceptedTags.includes('fall'),
        agentContext,
        selectedAdapter,
      );
    }

    let familyAcknowledgement = '';
    if (familyClaims.length > 0 && intent !== 'no_record') {
      familyAcknowledgement = buildFamilyAcknowledgement(
        familyClaims.map((claim) => ({ subject: claim.subject, text: claim.text })),
        shareMode,
      );
    }

    if (intent === 'no_record') {
      setChat((current) => [...current, msg('elder', text, now, persisted), msg('agent', agentText, now, persisted)]);
      showToast('这段内容不会保存到健康记录或家属端。');
      return;
    }

    if (understanding.correction) {
      const previousElder = [...chat].reverse().find((message) => message.role === 'elder');
      const previousInput = previousElder ? understandElderInput(previousElder.text, TODAY, chat) : null;
      const tagsToCorrect = previousInput?.claims.flatMap((claim) => claim.tags) ?? [];
      const priorFamilySubjects = previousInput?.claims.map((claim) => claim.subject).filter(isFamilySubject) ?? [];
      if (tagsToCorrect.length > 0) setEvents((current) => removeLatestCorrectedChatEvents(current, tagsToCorrect));
      if (tagsToCorrect.length > 0) {
        setFamilyEvents((current) => removeLatestCorrectedFamilyEvents(current, tagsToCorrect, priorFamilySubjects));
      }
    }

    const receivedAt = localIsoTimestamp();

    if (familyClaims.length > 0) {
      const incomingFamilyEvents = familyClaims.map(
        (claim, claimIndex): FamilyHealthEvent => ({
          id: `family-live-${Date.now()}-${claimIndex}`,
          timestamp: `${claim.eventDate ?? TODAY}T12:00:00`,
          source: 'chat',
          subject: claim.subject,
          text: claim.text,
          tags: claim.tags,
          hasHealthValue: claim.hasHealthValue,
          status: claim.status,
          visibility,
          shareMode,
        }),
      );
      setFamilyEvents((current) => [...current, ...incomingFamilyEvents]);
      if (intent === 'share_family') onShareFamilyEventIds(incomingFamilyEvents.map((event) => event.id));
    }

    if (canShare && shareMode !== 'private' && !sharingHistoryQuery) {
      const recipient = inferSharingRecipient(text);
      recordSharingAudit([
        ...acceptedClaims.map((claim, claimIndex) => ({
          id: `share-audit-${Date.now()}-self-${claimIndex}`,
          createdAt: localIsoTimestamp(),
          scope: 'self' as const,
          recipient,
          shareMode,
          content: claim.text,
        })),
        ...familyClaims.map((claim, claimIndex) => ({
          id: `share-audit-${Date.now()}-family-${claimIndex}`,
          createdAt: localIsoTimestamp(),
          scope: 'family' as const,
          recipient,
          shareMode,
          content: claim.text,
        })),
      ]);
    }

    if (acceptedClaims.length === 0) {
      const finalFamilyText = familyAcknowledgement || agentText;
      setChat((current) => [
        ...current,
        msg('elder', text, now, persisted),
        msg('agent', finalFamilyText, now, persisted),
      ]);
      showToast(finalFamilyText.replace(/\n/g, ' '));
      return;
    }

    const incomingEvents: HealthEvent[] = [];
    for (let claimIndex = 0; claimIndex < acceptedClaims.length; claimIndex += 1) {
      const claim = acceptedClaims[claimIndex];
      if (!shouldPersistClaim(claim)) continue;
      const extractedValues = extractHealthValues(claim.text);
      const eventDate = claim.eventDate ?? TODAY;
      incomingEvents.push(
        observationToEvent({
          id: `obs-live-${Date.now()}-${claimIndex}`,
          date: eventDate,
          source: 'chat',
          text: claim.text,
          tags: claim.tags,
          visibility,
        }),
      );
      for (const extracted of extractedValues) {
        incomingEvents.push(
          measurementToEvent({
            id: `chat-value-${Date.now()}-${claimIndex}-${extracted.metric}`,
            timestamp: `${eventDate}T12:00:00`,
            metric: extracted.metric,
            value: extracted.value,
            unit: extracted.unit,
            source: 'chat',
            confidence: 0.9,
            visibility,
            metadata: {
              sourceText: extracted.sourceText,
              extraction: 'rule',
              privacy: visibility,
              receivedAt,
              eventDate,
            },
          }),
        );
      }
    }

    if (incomingEvents.length === 0) {
      const finalFamilyText = familyAcknowledgement || agentText;
      setChat((current) => [
        ...current,
        msg('elder', text, now, persisted),
        msg('agent', finalFamilyText, now, persisted),
      ]);
      showToast(finalFamilyText.replace(/\n/g, ' '));
      return;
    }
    const nextEvents = appendHealthEvents(events, incomingEvents);
    setEvents(nextEvents);

    if (intent === 'share_family') {
      const shareableFindingIds = runDetection(nextEvents, TODAY)
        .filter(
          (finding) =>
            (finding.severity === 'alert' || finding.severity === 'urgent') &&
            finding.familyEligible !== false &&
            Boolean(finding.familyMessage),
        )
        .map((finding) => finding.id);
      onShareFindingIds(shareableFindingIds);
    }

    const values = acceptedClaims.flatMap((claim) => extractHealthValues(claim.text));
    const labels = acceptedTags.map(tagLabel);
    const valueText = values.map((item) => `${METRICS[item.metric].label} ${item.value}${item.unit}`);
    const recordSummary = [...labels, ...valueText].join('、');
    const timeNotice = acceptedClaims.some(
      (claim) => claim.timeScope === 'yesterday' || claim.timeScope === 'lastNight',
    )
      ? '按您说的时间归到昨晚/昨天，不当作今天新发生。'
      : '';
    const sharingNotice =
      intent === 'share_family'
        ? '这次只分享给家属一次，不会自动打开长期共享。'
        : canShare
          ? '按您现在的授权，家属可以看到必要的变化。'
          : '这部分只供您本人使用。';
    const safetyTags = new Set(['fall', 'medicationMissed', 'chestPain', 'neuroChange', 'dizziness']);
    const hasSafetyGuidance = acceptedTags.some((tag) => safetyTags.has(tag));
    const safetyNotice = acceptedTags.includes('fall')
      ? '现在最重要的是先确认安全：先别急着起身，看看有没有明显疼痛、出血、意识异常，或者站不起来。'
      : '';
    const guidance = hasSafetyGuidance ? agentText : '';
    const selfSharingReceipt =
      canShare && recordSummary ? buildSelfSharingAcknowledgement(recordSummary, shareMode) : '';
    const sharingReceipt = familyAcknowledgement || selfSharingReceipt || sharingNotice;
    const receiptParts = [
      guidance,
      recordSummary ? `我已经记下：${recordSummary}。${timeNotice}` : '',
      safetyNotice && !guidance.includes(safetyNotice) ? safetyNotice : '',
      sharingReceipt,
    ].filter(Boolean);
    const finalAgentText = receiptParts.join('\n');
    setChat((current) => [
      ...current,
      msg('elder', text, now, persisted),
      msg('agent', finalAgentText, now, persisted),
    ]);

    showToast(finalAgentText.replace(/\n/g, ' '));

    if (acceptedTags.includes('medicationMissed')) onMedicationMissed(receivedAt);
  }

  async function handlePhotoImport(file: Blob, kind: DemoImageKind) {
    try {
      const capturedAt = localIsoTimestamp();
      const visibility: HealthMeasurement['visibility'] = familySharing === 'granted' ? 'family_ok' : 'private';
      const parsed = await demoImageHealthParser.parse(file, { userId: DEMO_ELDER_ID, capturedAt, kind });
      const incomingEvents: HealthEvent[] = [
        ...parsed.measurements.map((measurement) => measurementToEvent({ ...measurement, visibility })),
        ...parsed.labResults.map((result) => ({
          id: `labResult:${result.id}`,
          type: 'labResult' as const,
          timestamp: result.timestamp,
          source: result.source,
          labResult: { ...result, visibility },
        })),
      ];
      if (parsed.tags.length > 0 || parsed.rawText) {
        incomingEvents.push(
          observationToEvent({
            id: `photo-obs-${Date.now()}`,
            date: TODAY,
            source: 'photo',
            text: parsed.rawText ?? '拍照录入（演示）',
            tags: parsed.tags,
            visibility,
          }),
        );
      }
      setEvents((current) => appendHealthEvents(current, incomingEvents));
      showToast(`${parsed.rawText ?? '拍照录入完成'}；数据按当前共享设置处理，这是 Demo 示例，请人工确认。`);
    } catch {
      showToast('这张图片暂时无法处理，请换一张或直接告诉我数据。');
    }
  }

  return { handleElderSend, handlePhotoImport, quickInputs: QUICK_INPUTS };
}
