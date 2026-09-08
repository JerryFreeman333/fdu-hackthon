import { useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ChatMessage, ElderProfile, Finding, HealthMeasurement, PrivacyScope } from '../types';
import { personalHealthRecordStore } from '../store/LocalHealthRecordStore';
import { TODAY } from '../data/demo';
import { appendHealthEvents, measurementToEvent, observationToEvent, type HealthEvent } from '../pipeline/events';
import { demoImageHealthParser, type DemoImageKind } from '../adapters/DemoImageHealthParser';
import { createHttpLlmAdapter, generateAgentReply, msg, QUICK_INPUTS, ruleBasedAdapter } from '../engine/agent';
import { extractHealthValues } from '../engine/extract';
import { canShareWithFamily, parsePrivacyIntent } from '../engine/privacy';
import { runDetection } from '../engine/detect';
import {
  acceptedSelfClaims,
  hasDeathReport,
  understandElderInput,
  type StructuredElderInput,
} from '../engine/understanding';

const DEMO_ELDER_ID = 'demo-elder-route1';

interface UseElderChatOptions {
  profile: ElderProfile;
  familySharing: ElderProfile['familySharing'];
  familyBound?: boolean;
  events: HealthEvent[];
  chat: ChatMessage[];
  findings: Finding[];
  agentContext: Parameters<typeof generateAgentReply>[4];
  setEvents: Dispatch<SetStateAction<HealthEvent[]>>;
  setChat: Dispatch<SetStateAction<ChatMessage[]>>;
  showToast: (text: string) => void;
  onMedicationMissed: (createdAt: string, visibility: PrivacyScope) => void;
  onShareFindingIds: (ids: string[]) => void;
}

function localIsoTimestamp(): string {
  return new Date().toISOString();
}

function recallSummary(chat: ChatMessage[]): string {
  const prior = chat.filter((message) => message.role === 'elder').slice(-4);
  if (prior.length === 0) return '我这次对话里还没有找到您之前说的话。您可以再告诉我一次，我不会自己编造记忆。';
  return `我能看到这次对话里您之前说过：\n${prior.map((message) => `“${message.text}”`).join('\n')}`;
}

function shouldPersistClaim(claim: StructuredElderInput['claims'][number]): boolean {
  return (
    claim.subject === 'self' &&
    claim.status === 'occurred' &&
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

function isCurrentReassurance(text: string): boolean {
  return /^(?:我)?(?:现在)?(?:感觉)?(?:没事|没什么事|没什么事情|还好|挺好的)[。！!,.，]*$/.test(text.trim());
}

export function useElderChat({
  profile,
  familySharing,
  familyBound = false,
  events,
  chat,
  findings,
  agentContext,
  setEvents,
  setChat,
  showToast,
  onMedicationMissed,
  onShareFindingIds,
}: UseElderChatOptions) {
  const busyRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [failedText, setFailedText] = useState('');
  async function handleElderSend(text: string, retry = false) {
    if (busyRef.current || !text.trim()) return;
    busyRef.current = true;
    setPending(true);
    setFailedText('');
    try {
      const intent = parsePrivacyIntent(text);
      const understanding = understandElderInput(text, TODAY, chat);
      const acceptedClaims = acceptedSelfClaims(understanding);
      const acceptedTags = [...new Set(acceptedClaims.flatMap((claim) => claim.tags))];
      const canShare = canShareWithFamily(familySharing, intent);
      const visibility = canShare ? 'family_ok' : 'private';
      const now = `${TODAY.slice(5)} ${new Date().toTimeString().slice(0, 5)}`;
      const persisted = intent !== 'no_record';

      if (!retry) setChat((current) => [...current, msg('elder', text, now, persisted)]);
      let agentText: string;
      if (understanding.recallRequested) {
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
      } else if (acceptedTags.length === 0 && acceptedClaims.length === 0 && understanding.claims.length > 0) {
        agentText =
          '我先不把这句话记成您的健康事实。您可以告诉我：说的是您自己，还是家里其他人？事情已经发生了，还是只是想问问这种情况怎么办？';
      } else {
        const selectedAdapter =
          intent === 'private' || intent === 'no_record' || !import.meta.env.VITE_AGENT_LLM_ENDPOINT
            ? ruleBasedAdapter
            : createHttpLlmAdapter(import.meta.env.VITE_AGENT_LLM_ENDPOINT, chat, profile);
        agentText = await generateAgentReply(
          text,
          acceptedTags,
          findings,
          acceptedTags.includes('fall'),
          agentContext,
          selectedAdapter,
        );
      }

      setChat((current) => [...current, msg('agent', agentText, now, persisted)]);

      if (intent === 'no_record') {
        showToast('这段内容不会保存到健康记录或家属端。');
        return;
      }

      if (understanding.correction) {
        const previousElder = [...chat].reverse().find((message) => message.role === 'elder');
        const previousInput = previousElder ? understandElderInput(previousElder.text, TODAY, chat) : null;
        const tagsToCorrect = previousInput?.claims.flatMap((claim) => claim.tags) ?? [];
        if (tagsToCorrect.length > 0) setEvents((current) => removeLatestCorrectedChatEvents(current, tagsToCorrect));
      }

      if (acceptedClaims.length === 0) return;

      const incomingEvents: HealthEvent[] = [];
      const receivedAt = localIsoTimestamp();
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

      if (incomingEvents.length === 0) return;
      const nextEvents = appendHealthEvents(
        events,
        incomingEvents.map((event) =>
          intent === 'share_family' && event.type === 'observation' ? { ...event, sharedOnce: true } : event,
        ),
      );
      personalHealthRecordStore.save({
        events: nextEvents,
        chat: [...chat, ...(!retry ? [msg('elder', text, now)] : []), msg('agent', agentText, now)],
      });
      setEvents(nextEvents);

      if (intent === 'share_family') {
        const nextFindings = runDetection(nextEvents, TODAY);
        const shareableFindingIds = nextFindings
          .filter(
            (finding) =>
              (finding.severity === 'alert' || finding.severity === 'urgent') &&
              finding.familyEligible !== false &&
              Boolean(finding.familyMessage),
          )
          .map((finding) => finding.id);
        onShareFindingIds(shareableFindingIds);
      }

      const timeNotice = acceptedClaims.some(
        (claim) => claim.timeScope === 'yesterday' || claim.timeScope === 'lastNight',
      )
        ? '；按您说的时间归到昨晚/昨天，不当作今天新发生'
        : '';
      const receipt = [
        '已记录：' + acceptedClaims.map((claim) => claim.text).join('；') + timeNotice,
        canShare && familyBound
          ? '记录时家属可在报告中查看以上内容，不代表已收到通知或已读；当前权限以报告页为准。'
          : '目前仅自己可见。可在报告中选择只共享这条记录。',
        acceptedTags.includes('fall') ? '现在先别急着起来，确认有没有受伤或站不起来；需要时请联系身边的人或急救。' : '',
      ]
        .filter(Boolean)
        .join('\n');
      setChat((current) => [...current, msg('agent', receipt, now)]);
      showToast('已保存，记录结果已显示在对话中');

      if (acceptedTags.includes('medicationMissed')) onMedicationMissed(receivedAt, visibility);
    } catch {
      setFailedText(text);
    } finally {
      busyRef.current = false;
      setPending(false);
    }
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

  return {
    handleElderSend,
    handlePhotoImport,
    quickInputs: QUICK_INPUTS,
    pending,
    failedText,
    retrySend: () => handleElderSend(failedText, true),
  };
}
