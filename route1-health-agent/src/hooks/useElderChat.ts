import { useRef } from 'react';
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
import { removeCorrectedChatHealthEvents, removeCorrectedFamilyEvents } from '../engine/correction';

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

function isCurrentReassurance(text: string): boolean {
  return /^(?:我)?(?:现在)?(?:感觉)?(?:没事|没什么事|没什么事情|还好|挺好的)[。！!,.，]*$/.test(text.trim());
}

export function shouldCommitElderTurn(turnId: number, latestTurnId: number): boolean {
  return turnId === latestTurnId;
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
  const latestTurnRef = useRef(0);

  async function handleElderSend(text: string) {
    const turnId = ++latestTurnRef.current;
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
    const elderMessage = msg('elder', text, now, persisted);

    let agentText: string;
    if (sharingHistoryQuery) {
      const recipient = /女儿/.test(text)
        ? 'daughter'
        : /儿子/.test(text)
          ? 'son'
          : /家属|孩子/.test(text)
            ? 'family'
            : undefined;
      agentText = buildHistoricalSharingAnswer(loadSharingAudit(), recipient ?? inferSharingRecipient(text));
    } else if (understanding.recallRequested) {
      agentText = recallSummary(chat);
    } else if (understanding.clarificationQuestion) {
      agentText = understanding.clarificationQuestion;
    } else if (understanding.correction && acceptedClaims.length === 0 && familyClaims.length === 0) {
      agentText = '好的，我只会撤销刚才那句话对应的健康事实，不会碰其他已经记录的事情。您可以告诉我正确的情况。';
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

    if (!shouldCommitElderTurn(turnId, latestTurnRef.current)) return;

    let familyAcknowledgement = '';
    if (familyClaims.length > 0 && intent !== 'no_record') {
      familyAcknowledgement = buildFamilyAcknowledgement(
        familyClaims.map((claim) => ({ subject: claim.subject, text: claim.text })),
        shareMode,
      );
    }

    if (intent === 'no_record') {
      setChat((current) => [...current, elderMessage, msg('agent', agentText, now, persisted)]);
      showToast('这段内容不会保存到健康记录或家属端。');
      return;
    }

    if (!shouldCommitElderTurn(turnId, latestTurnRef.current)) return;

    let nextBaseEvents = events;
    if (understanding.correction && understanding.correctionTargetMessageId) {
      nextBaseEvents = removeCorrectedChatHealthEvents(nextBaseEvents, understanding.correctionTargetMessageId);
      setFamilyEvents((current) => removeCorrectedFamilyEvents(current, understanding.correctionTargetMessageId));
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
          sourceMessageId: elderMessage.id,
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
      setChat((current) => [...current, elderMessage, msg('agent', finalFamilyText, now, persisted)]);
      showToast(finalFamilyText.replace(/\n/g, ' '));
      setEvents(nextBaseEvents);
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
          metadata: {
            sourceMessageId: elderMessage.id,
          },
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
              sourceMessageId: elderMessage.id,
            },
          }),
        );
      }
    }

    if (incomingEvents.length === 0) {
      const finalFamilyText = familyAcknowledgement || agentText;
      setChat((current) => [...current, elderMessage, msg('agent', finalFamilyText, now, persisted)]);
      showToast(finalFamilyText.replace(/\n/g, ' '));
      setEvents(nextBaseEvents);
      return;
    }
    const nextEvents = appendHealthEvents(nextBaseEvents, incomingEvents);
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
    const safetyTags = new Set([
      'fall',
      'medicationMissed',
      'chestPain',
      'neuroChange',
      'dizziness',
      'spo2Low',
      'hrHigh',
      'hrLow',
      'glucoseHigh',
      'glucoseLow',
    ]);
    const hasSafetyGuidance = acceptedTags.some((tag) => safetyTags.has(tag));
    const SAFETY_NOTICES: Record<string, string> = {
      fall: '现在最重要的是先确认安全：先别照急起身，看看有没有明显疼痛、出血、意识异常，或者站不起来。',
      spo2Low:
        '现在最重要的是保持呼吸：先坐稳、保持手部温暖，按设备说明复测一次；如果仍低或伴嘴唇发紫、测不到呼吸，立即告诉我们或找家人。',
      hrHigh:
        '现在最重要的是先停下休息：走动起来都不要急，按设备说明复测；如果仍快或伴胸闷、头晕，立即告诉我们或找家人。',
      hrLow: '现在最重要的是先坐下不要独自活动：按设备说明复测；如果仍慢或伴头晕、黑眉，立即告诉我们或找家人。',
      glucoseHigh: '现在最重要的是保持调节：复测一次确认测量时间和是否空腹；持续偏高或伴口渴、意识变化，请联系医生。',
      glucoseLow:
        '现在最重要的是避免低血糖危险：按医生方案补糖，15 分钟内复测；如出现意识变化、站不稳或出冷汗，立即告诉我们或找家人。',
    };
    const safetyNotice =
      acceptedTags
        .map((tag) => SAFETY_NOTICES[tag])
        .filter((notice): notice is string => Boolean(notice))
        .join(' ') || '';
    const guidance = hasSafetyGuidance ? agentText : '';
    const selfSharingReceipt =
      canShare && recordSummary ? buildSelfSharingAcknowledgement(recordSummary, shareMode) : '';
    const sharingReceipt = familyAcknowledgement || selfSharingReceipt || sharingNotice;
    const receiptParts = [
      guidance,
      understanding.correction ? '已按您刚才的更正，只处理上一句话对应的事实；其他记录保持不变。' : '',
      recordSummary ? `我已经记下：${recordSummary}。${timeNotice}` : '',
      safetyNotice && !guidance.includes(safetyNotice) ? safetyNotice : '',
      sharingReceipt,
    ].filter(Boolean);
    const finalAgentText = receiptParts.join('\n');
    setChat((current) => [...current, elderMessage, msg('agent', finalAgentText, now, persisted)]);

    showToast(finalAgentText.replace(/\n/g, ' '));

    if (acceptedTags.includes('medicationMissed')) onMedicationMissed(receivedAt);
  }

  async function handlePhotoImport(file: Blob, kind: DemoImageKind) {
    try {
      const capturedAt = localIsoTimestamp();
      const visibility: HealthMeasurement['visibility'] = familySharing === 'granted' ? 'family_ok' : 'private';
      const parsed = await demoImageHealthParser.parse(file, { userId: DEMO_ELDER_ID, capturedAt, kind });
      const measurements = parsed.measurements.map((item) => measurementToEvent({ ...item, visibility }));
      if (measurements.length === 0) {
        showToast('这张图片没有识别到可记录的健康数值。');
        return;
      }
      setEvents((current) => appendHealthEvents(current, measurements));
      showToast(`已记录 ${measurements.length} 项图片中的健康数值。`);
    } catch (error) {
      console.error(error);
      showToast('图片解析失败，请稍后重试。');
    }
  }

  return { handleElderSend, handlePhotoImport, quickInputs: QUICK_INPUTS };
}
