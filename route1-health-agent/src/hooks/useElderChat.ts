import type { Dispatch, SetStateAction } from 'react';
import type { ChatMessage, ElderProfile, Finding, HealthMeasurement } from '../types';
import { METRICS } from '../types';
import { TODAY } from '../data/demo';
import { appendHealthEvents, measurementToEvent, observationToEvent, type HealthEvent } from '../pipeline/events';
import { demoImageHealthParser, type DemoImageKind } from '../adapters/DemoImageHealthParser';
import {
  createHttpLlmAdapter,
  generateAgentReply,
  msg,
  parseElderInput,
  QUICK_INPUTS,
  ruleBasedAdapter,
  tagLabel,
} from '../engine/agent';
import { extractHealthValues } from '../engine/extract';
import { canShareWithFamily, parsePrivacyIntent } from '../engine/privacy';
import { runDetection } from '../engine/detect';

const DEMO_ELDER_ID = 'demo-elder-route1';
const llmAdapter = import.meta.env.VITE_AGENT_LLM_ENDPOINT
  ? createHttpLlmAdapter(import.meta.env.VITE_AGENT_LLM_ENDPOINT)
  : ruleBasedAdapter;

interface UseElderChatOptions {
  familySharing: ElderProfile['familySharing'];
  events: HealthEvent[];
  findings: Finding[];
  agentContext: Parameters<typeof generateAgentReply>[4];
  setEvents: Dispatch<SetStateAction<HealthEvent[]>>;
  setChat: Dispatch<SetStateAction<ChatMessage[]>>;
  showToast: (text: string) => void;
  onMedicationMissed: (createdAt: string) => void;
  onShareFindingIds: (ids: string[]) => void;
}

function localIsoTimestamp(): string {
  return new Date().toISOString();
}

export function useElderChat({
  familySharing,
  events,
  findings,
  agentContext,
  setEvents,
  setChat,
  showToast,
  onMedicationMissed,
  onShareFindingIds,
}: UseElderChatOptions) {
  async function handleElderSend(text: string) {
    const intent = parsePrivacyIntent(text);
    const { tags } = parseElderInput(text);
    const extractedValues = extractHealthValues(text);
    const canShare = canShareWithFamily(familySharing, intent);
    const visibility = canShare ? 'family_ok' : 'private';
    const now = `${TODAY.slice(5)} ${new Date().toTimeString().slice(0, 5)}`;
    const persisted = intent !== 'no_record';
    const selectedAdapter = intent === 'private' || intent === 'no_record' ? ruleBasedAdapter : llmAdapter;
    const agentText = await generateAgentReply(
      text,
      tags,
      findings,
      tags.includes('fall'),
      agentContext,
      selectedAdapter,
    );
    setChat((current) => [...current, msg('elder', text, now, persisted), msg('agent', agentText, now, persisted)]);

    if (intent === 'no_record') {
      showToast('这段内容不会保存到健康记录或家属端。');
      return;
    }

    const eventTimestamp = localIsoTimestamp();
    const incomingEvents: HealthEvent[] = [];
    if (tags.length > 0) {
      incomingEvents.push(
        observationToEvent({
          id: `obs-live-${Date.now()}`,
          date: TODAY,
          source: 'chat',
          text,
          tags,
          visibility,
        }),
      );
    }

    for (const extracted of extractedValues) {
      const measurement: HealthMeasurement = {
        id: `chat-value-${Date.now()}-${extracted.metric}`,
        timestamp: eventTimestamp,
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
        },
      };
      incomingEvents.push(measurementToEvent(measurement));
    }

    if (incomingEvents.length > 0) {
      const nextEvents = appendHealthEvents(events, incomingEvents);
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

      const labels = tags.map(tagLabel);
      const values = extractedValues.map((item) => `${METRICS[item.metric].label} ${item.value}${item.unit}`);
      const sharingNotice =
        intent === 'share_family'
          ? '；这次明确分享给家属，不会自动修改长期共享设置'
          : canShare
            ? '；按当前授权可供家属查看必要变化'
            : '；仅供您本人使用';
      showToast(`已记录：${[...labels, ...values].join('、')}${sharingNotice}`);
    }

    if (tags.includes('medicationMissed')) onMedicationMissed(eventTimestamp);
    if (tags.includes('fall')) showToast('已标记为紧急事件，请先确认安全并保持电话畅通。');
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
      showToast(
        `${parsed.rawText ?? '拍照录入完成'}；数据按当前共享设置处理，这是 Demo 示例，请人工确认。`,
      );
    } catch {
      showToast('这张图片暂时无法处理，请换一张或直接告诉我数据。');
    }
  }

  return { handleElderSend, handlePhotoImport, quickInputs: QUICK_INPUTS };
}
