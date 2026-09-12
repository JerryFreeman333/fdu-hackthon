import { useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ChatMessage, ElderProfile, FamilyHealthEvent, Finding } from '../types';
import { formatLocalDate } from '../data/demo';
import { chatClockLabel } from '../engine/clock';
import type { HealthEvent } from '../pipeline/events';
import { appendHealthEvents, labResultToEvent, measurementToEvent } from '../pipeline/events';
import { selectImageParser } from '../adapters/parserSelector';
import type { ParsedHealthData } from '../adapters/ImageHealthParser';
import type { DemoImageKind } from '../adapters/DemoImageHealthParser';
import { createHttpLlmAdapter, generateAgentReply, msg, QUICK_INPUTS, ruleBasedAdapter } from '../engine/agent';
import { understandElderInput, type StructuredElderInput } from '../engine/understanding';
import {
  canUseLlmUnderstanding,
  resolveUnderstandingLlmConfig,
  understandElderInputWithLlm,
} from '../engine/llmUnderstanding';
import { parsePrivacyIntent } from '../engine/privacy';
import { planElderTurn } from '../engine/elderTurn';
import { removeCorrectedChatHealthEvents, removeCorrectedFamilyEvents } from '../engine/correction';
import { recordSharingAudit } from '../engine/sharingAudit';
import { createTurnQueue, type TurnQueue } from '../engine/turnQueue';

const DEMO_ELDER_ID = 'demo-elder-route1';
// 回复层 LLM 超时（P1-4）：默认收窄到 12s，可用 VITE_AGENT_LLM_TIMEOUT_MS 调整。
// 超时或失败都会降级到规则回复，老人最迟十几秒内一定得到回应；视觉上的即时
// 反馈由"正在听你说…"占位气泡保证（见 handleElderSend）。
const AGENT_LLM_TIMEOUT_MS = Number(import.meta.env.VITE_AGENT_LLM_TIMEOUT_MS);
const llmAdapter = import.meta.env.VITE_AGENT_LLM_ENDPOINT
  ? createHttpLlmAdapter(
      import.meta.env.VITE_AGENT_LLM_ENDPOINT,
      Number.isFinite(AGENT_LLM_TIMEOUT_MS) && AGENT_LLM_TIMEOUT_MS >= 1000 ? AGENT_LLM_TIMEOUT_MS : 12000,
    )
  : ruleBasedAdapter;

interface UseElderChatOptions {
  /** 注入的"今天"（评审 P1-4）：来自 App 的时钟服务，跨午夜后新回合归到新的一天。 */
  today: string;
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
  /** P0-1 配套：本回合新事件同步给同浏览器其它 tab（只走 BroadcastChannel）。 */
  onBroadcastEvents?: (events: HealthEvent[]) => void;
}

function localIsoTimestamp(): string {
  // 本地墙上时间（无时区后缀），与 Demo 数据 `${date}T12:00:00` 约定一致：
  // slice(0, 10) 恒等于本地日期。toISOString 会在 UTC+8 的 0-8 点把日期算成前一天，
  // 导致拍照录入落在"今天"之外、被全部检测窗口排除。
  const now = new Date();
  const pad = (value: number, width = 2): string => `${value}`.padStart(width, '0');
  return `${formatLocalDate(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(
    now.getMilliseconds(),
    3,
  )}`;
}

export function useElderChat({
  today,
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
  onBroadcastEvents,
}: UseElderChatOptions) {
  const turnQueueRef = useRef<TurnQueue | null>(null);
  if (!turnQueueRef.current) turnQueueRef.current = createTurnQueue();

  async function handleElderSend(text: string) {
    const intent = parsePrivacyIntent(text);
    const persisted = intent !== 'no_record';
    const now = chatClockLabel(today, new Date());
    const elderMessage = msg('elder', text, now, persisted);
    // 回显与上下文在入队前定格：队列里的后续回合会继续改写 chat。
    const priorChat = chat;

    // 占位回复（P0-3/P1-4）：与老人原话同时上屏，位置紧跟原话。
    // 回复就绪后原地替换——老人连发多条时，每条回复一定紧跟触发它的那句话，
    // 不会再出现"对着'头一点都不晕了'说'我已记下头晕'"的错位；
    // LLM 再慢，老人也能立刻看到"正在听你说…"，而不是可疑的沉默。
    const pendingReply: ChatMessage = { ...msg('agent', '', now, false), pending: true };
    setChat((current) => [...current, elderMessage, pendingReply]);

    void turnQueueRef.current?.enqueue(async () => {
      try {
        await runElderTurn(text, elderMessage, priorChat, pendingReply.id);
      } catch (error) {
        console.error(error);
        const failureReply = msg('agent', '这条消息没有处理成功，麻烦您再说一次。', now, false);
        setChat((current) => settlePendingReply(current, pendingReply.id, failureReply));
        showToast('这条消息没有处理成功，麻烦您再说一次。');
      }
    });
  }

  /**
   * 理解层入口：配置了理解层 LLM 且输入不含私密意图时，用真实语言理解仲裁
   * 症状识别（标签）与肯否语义两个轴；其余情况（未配置 / private / no_record）
   * 走纯规则，原话一个字都不出本地。
   */
  async function buildUnderstanding(
    text: string,
    priorChat: ChatMessage[],
    intent: ReturnType<typeof parsePrivacyIntent>,
  ): Promise<StructuredElderInput> {
    const config = resolveUnderstandingLlmConfig(import.meta.env);
    if (canUseLlmUnderstanding(intent, config !== null)) {
      return understandElderInputWithLlm(text, today, priorChat, config as NonNullable<typeof config>);
    }
    return understandElderInput(text, today, priorChat);
  }

  /**
   * P0-3 的配对机制：把就绪的回复写进占位气泡的位置（找不到占位则追加兜底）。
   * 用 setState 更新器内部完成查找与替换，保证原子性。
   */
  function settlePendingReply(current: ChatMessage[], pendingId: string, reply: ChatMessage): ChatMessage[] {
    const index = current.findIndex((item) => item.id === pendingId);
    if (index < 0) return [...current, reply];
    const next = [...current];
    next[index] = { ...reply, id: pendingId };
    return next;
  }

  /**
   * 一回合 = 纯规划（engine/elderTurn.planElderTurn）+ 执行（本函数）。
   * 规划层决定回复分块、待入库事件、家属同步与提示文案；这里只做状态更新
   * 与副作用，且执行顺序与旧实现保持一致。
   */
  async function runElderTurn(
    text: string,
    elderMessage: ChatMessage,
    priorChat: ChatMessage[],
    pendingReplyId: string,
  ) {
    const intent = parsePrivacyIntent(text);
    const understanding = await buildUnderstanding(text, priorChat, intent);
    const now = elderMessage.time;
    const persisted = elderMessage.persisted ?? true;
    const receivedAt = localIsoTimestamp();

    const plan = await planElderTurn({
      text,
      understanding,
      priorChat,
      findings,
      events,
      familySharing,
      agentContext,
      llmAdapter,
      today,
      now,
      receivedAt,
      sourceMessageId: elderMessage.id,
      idSeed: Date.now(),
    });

    const { correction } = plan;
    if (correction) {
      setFamilyEvents((current) => removeCorrectedFamilyEvents(current, correction.messageId));
    }
    if (plan.familyEventsToAppend.length > 0) {
      setFamilyEvents((current) => [...current, ...plan.familyEventsToAppend]);
    }
    if (plan.sharingAuditEntries.length > 0) {
      recordSharingAudit(plan.sharingAuditEntries);
    }
    if (plan.shareFamilyEventIds.length > 0) {
      onShareFamilyEventIds(plan.shareFamilyEventIds);
    }
    if (plan.eventsToAppend.length > 0) {
      setEvents((current) =>
        appendHealthEvents(
          correction ? removeCorrectedChatHealthEvents(current, correction.messageId, correction.tags) : current,
          plan.eventsToAppend,
        ),
      );
      // P0-1 配套：同浏览器其它 tab（如已打开的家属端）实时补齐事件，
      // 否则家属端自己的检测/门控状态永远停留在打开那一刻的快照。
      onBroadcastEvents?.(plan.eventsToAppend);
      if (plan.shareFindingIds.length > 0) onShareFindingIds(plan.shareFindingIds);
    }
    if (plan.medicationMissed) onMedicationMissed(receivedAt);

    const reply = msg('agent', plan.replyText, now, persisted, {
      safetyAction: plan.safetyAction,
      blocks: plan.replyBlocks,
    });
    setChat((current) => settlePendingReply(current, pendingReplyId, reply));
    showToast(plan.toast);
  }

  const [pendingPhoto, setPendingPhoto] = useState<ParsedHealthData | null>(null);
  const [pendingPhotoKind, setPendingPhotoKind] = useState<DemoImageKind | null>(null);
  const [pendingPhotoError, setPendingPhotoError] = useState<string | null>(null);

  async function handlePhotoImport(file: Blob, kind: DemoImageKind) {
    setPendingPhotoError(null);
    try {
      const capturedAt = localIsoTimestamp();
      const { parser, mode } = selectImageParser({
        endpointOverride: import.meta.env.VITE_HEALTH_VISION_ENDPOINT?.trim() || undefined,
      });
      const parsed = await parser.parse(file, { userId: DEMO_ELDER_ID, capturedAt, kind });
      if (parsed.measurements.length === 0 && parsed.labResults.length === 0) {
        setPendingPhotoError('这张图片没有识别到可记录的健康数值，请换一张。');
        return;
      }
      setPendingPhoto(parsed);
      setPendingPhotoKind(kind);
      showToast(
        mode === 'real-http'
          ? '识别完成，请确认是否记录。'
          : '示例识别完成，请确认是否记录。\n（演示模式，未走真实视觉模型）',
      );
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : '未知错误';
      setPendingPhotoError(`图片解析失败：${message}`);
    }
  }

  function commitPhotoImport() {
    if (!pendingPhoto) return;
    // visibility 与 family sharing 保持一致：granted -> 子女可见，否则私密。
    // 真实数据走 HealthVisionProvider 时，ELDER 端通常不会带 visibility；这里按授权状态补一个标签。
    const photoVisibility = familySharing === 'granted' ? 'family_ok' : 'private';
    const events = [
      ...pendingPhoto.measurements.map((m) => measurementToEvent({ ...m, visibility: photoVisibility })),
      ...pendingPhoto.labResults.map((l) => labResultToEvent({ ...l, visibility: photoVisibility })),
    ];
    if (events.length === 0) {
      setPendingPhoto(null);
      setPendingPhotoKind(null);
      return;
    }
    setEvents((current) => appendHealthEvents(current, events));
    showToast(`已记录 ${events.length} 项健康数值。`);
    setPendingPhoto(null);
    setPendingPhotoKind(null);
  }

  function cancelPhotoImport() {
    setPendingPhoto(null);
    setPendingPhotoKind(null);
    setPendingPhotoError(null);
  }

  return {
    handleElderSend,
    handlePhotoImport,
    commitPhotoImport,
    cancelPhotoImport,
    pendingPhoto,
    pendingPhotoKind,
    pendingPhotoError,
    quickInputs: QUICK_INPUTS,
  };
}
