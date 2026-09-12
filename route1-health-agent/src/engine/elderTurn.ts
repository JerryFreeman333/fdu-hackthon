/**
 * 老人回合的纯规划层（评审 P1-5）。
 *
 * 之前整条回合逻辑长在 useElderChat 里：理解结果怎么用、回复说什么、
 * 哪些事件入库、哪些同步给家属、toast 提示什么，全部和 React 状态更新
 * 纠缠在一个 300 行的函数里，只能靠真机点出来验证。
 *
 * planElderTurn 把"这一回合要做什么"变成可单测的纯规划：
 * 输入理解结果与当前状态，输出一份 ElderTurnPlan（回复分块、待入库事件、
 * 待同步的家属事实、共享台账、提示文案）；hook 只负责执行（状态更新与副作用）。
 *
 * 回复同时改分块（评审 P1-5）：主气泡放直接回答/安全指导，记录与复测回执
 * 降为小字，隐私与共享声明独立成行；replyText 保留与旧版单气泡一致的拼接，
 * toast 与既有断言不受影响。TTS 只读主气泡。
 */
import type {
  ChatMessage,
  ChatMessageBlock,
  ElderProfile,
  ElderSubject,
  FamilyHealthEvent,
  FamilyShareMode,
  Finding,
  SymptomTag,
} from '../types';
import { METRICS } from '../types';
import type { HealthEvent } from '../pipeline/events';
import { appendHealthEvents, measurementToEvent, observationToEvent } from '../pipeline/events';
import { generateAgentReply, ruleBasedAdapter, tagLabel, type LlmAdapter } from './agent';
import { extractHealthValues } from './extract';
import { canShareWithFamily, parsePrivacyIntent } from './privacy';
import { runDetection } from './detect';
import { buildFamilyAcknowledgement, buildSelfSharingAcknowledgement, buildUnacceptedClaimsReply } from './userFacing';
import {
  buildHistoricalSharingAnswer,
  inferSharingRecipient,
  loadSharingAudit,
  type SharingAuditCandidate,
} from './sharingAudit';
import { acceptedSelfClaims, hasDeathReport, type StructuredElderInput } from './understanding';
import { removeCorrectedChatHealthEvents } from './correction';

type FamilySubject = Exclude<ElderSubject, 'self' | 'unknown'>;

export interface ElderTurnRequest {
  text: string;
  understanding: StructuredElderInput;
  /** 回合开始前的聊天记录（"我刚才说过什么"召回用）。 */
  priorChat: ChatMessage[];
  findings: Finding[];
  /** 当前事件流（share_family 时对合并结果重跑检测，确定这次一次性共享哪些告警）。 */
  events: HealthEvent[];
  familySharing: ElderProfile['familySharing'];
  agentContext: Parameters<typeof generateAgentReply>[4];
  /** 非隐私回合使用的回复适配器（private/no_record 恒走规则适配器）。 */
  llmAdapter: LlmAdapter;
  /** 注入的"今天"（评审 P1-4）：跨午夜后新回合归到新的一天。 */
  today: string;
  /** 聊天时间标签（来自时钟服务的 chatClockLabel）。 */
  now: string;
  /** 事件 receivedAt（本地 ISO 时间戳）。 */
  receivedAt: string;
  /** 本回合老人消息 id：事件与家属事实用它关联来源消息。 */
  sourceMessageId: string;
  /** id 种子（Date.now()）：同一回合内的事件/台账 id 唯一。 */
  idSeed: number;
}

export interface ElderTurnPlan {
  recordIntent: 'record' | 'no_record';
  /** 结构化分块：主气泡 / 小字回执 / 独立隐私行。 */
  replyBlocks: ChatMessageBlock[];
  /** 与旧版单气泡拼接一致的完整文本（toast、持久化与既有断言依赖它）。 */
  replyText: string;
  safetyAction: boolean;
  /** 更正：先把上一条消息对应的事实从事件流/家属记录里撤掉，再落新事件。 */
  correction: { messageId: string; tags?: SymptomTag[] } | null;
  eventsToAppend: HealthEvent[];
  familyEventsToAppend: FamilyHealthEvent[];
  sharingAuditEntries: SharingAuditCandidate[];
  shareFamilyEventIds: string[];
  /** 仅完整记录路径给出（与旧版一致：提前返回的分支不触发告警共享）。 */
  shareFindingIds: string[];
  /** 仅完整记录路径为 true：提前返回的分支不触发用药任务（旧版行为）。 */
  medicationMissed: boolean;
  toast: string;
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

const SAFETY_TAGS = new Set([
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

const SAFETY_NOTICES: Record<string, string> = {
  fall: '现在最重要的是先确认安全：先别着急起身，看看有没有明显疼痛、出血、意识异常，或者站不起来。',
  spo2Low:
    '现在最重要的是保持呼吸：先坐稳、保持手部温暖，按设备说明复测一次；如果仍低或伴嘴唇发紫、测不到呼吸，立即告诉我们或找家人。',
  hrHigh: '现在最重要的是先停下休息：走动起来都不要急，按设备说明复测；如果仍快或伴胸闷、头晕，立即告诉我们或找家人。',
  hrLow: '现在最重要的是先坐下不要独自活动：按设备说明复测；如果仍慢或伴头晕、黑朦，立即告诉我们或找家人。',
  glucoseHigh: '现在最重要的是保持调节：复测一次确认测量时间和是否空腹；持续偏高或伴口渴、意识变化，请联系医生。',
  glucoseLow:
    '现在最重要的是避免低血糖危险：按医生方案补糖，15 分钟内复测；如出现意识变化、站不稳或出冷汗，立即告诉我们或找家人。',
};

const NO_RECORD_LINE = '这段内容不会保存到健康记录或家属端。';

export async function planElderTurn(request: ElderTurnRequest): Promise<ElderTurnPlan> {
  const {
    text,
    understanding,
    priorChat,
    findings,
    events,
    familySharing,
    agentContext,
    llmAdapter,
    today,
    receivedAt,
    sourceMessageId,
    idSeed,
  } = request;
  const intent = parsePrivacyIntent(text);
  const sharingHistoryQuery = sharingHistoryRequested(text);
  // 存在未解决的紧急发现时，任何回复旁边都保留紧急联系行动条：
  // 老人此时最需要的是"马上能按的电话"，不是先组织语言。
  const hasUrgentFinding = findings.some((finding) => finding.severity === 'urgent');
  let forceSafetyActions = false;

  const acceptedClaims = acceptedSelfClaims(understanding);
  const acceptedTags = [...new Set(acceptedClaims.flatMap((claim) => claim.tags))];
  const familyClaims = understanding.claims.filter(shouldPersistFamilyClaim);
  const familyOnlyClaims = understanding.claims.filter(
    (claim) =>
      claim.subject !== 'self' && claim.subject !== 'unknown' && (claim.tags.length > 0 || claim.hasHealthValue),
  );
  const canShare = canShareWithFamily(familySharing, intent);
  const visibility = canShare ? 'family_ok' : 'private';
  const shareMode: FamilyShareMode = intent === 'share_family' ? 'one_time' : canShare ? 'persistent' : 'private';

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
    agentText = recallSummary(priorChat);
  } else if (understanding.clarificationQuestion) {
    agentText = understanding.clarificationQuestion;
  } else if (understanding.correction && acceptedClaims.length === 0 && familyClaims.length === 0) {
    agentText = '好的，我只会撤销刚才那句话对应的健康事实，不会碰其他已经记录的事情。您可以告诉我正确的情况。';
  } else if (hasDeathReport(understanding)) {
    forceSafetyActions = true;
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
    agentText = buildUnacceptedClaimsReply(understanding.claims);
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

  if (intent === 'no_record') {
    // 隐私行独立成块：不记录的边界直接显示在回复里，而不只是转瞬即逝的 toast。
    return {
      recordIntent: 'no_record',
      replyBlocks: [
        { kind: 'main', text: agentText },
        { kind: 'privacy', text: NO_RECORD_LINE },
      ],
      replyText: agentText,
      safetyAction: forceSafetyActions || hasUrgentFinding,
      correction: null,
      eventsToAppend: [],
      familyEventsToAppend: [],
      sharingAuditEntries: [],
      shareFamilyEventIds: [],
      shareFindingIds: [],
      medicationMissed: false,
      toast: NO_RECORD_LINE,
    };
  }

  const correction =
    understanding.correction && understanding.correctionTargetMessageId
      ? { messageId: understanding.correctionTargetMessageId, tags: understanding.correctionTargetTags }
      : null;

  const familyAcknowledgement =
    familyClaims.length > 0
      ? buildFamilyAcknowledgement(
          familyClaims.map((claim) => ({ subject: claim.subject, text: claim.text })),
          shareMode,
        )
      : '';

  const familyEventsToAppend: FamilyHealthEvent[] = familyClaims.map((claim, claimIndex) => ({
    id: `family-live-${idSeed}-${claimIndex}`,
    timestamp: `${claim.eventDate ?? today}T12:00:00`,
    source: 'chat',
    subject: claim.subject,
    text: claim.text,
    tags: claim.tags,
    hasHealthValue: claim.hasHealthValue,
    status: claim.status,
    visibility,
    shareMode,
    sourceMessageId,
  }));

  const recipient = inferSharingRecipient(text);
  const sharingAuditEntries: SharingAuditCandidate[] =
    canShare && shareMode !== 'private' && !sharingHistoryQuery
      ? [
          ...acceptedClaims.map((claim, claimIndex) => ({
            id: `share-audit-${idSeed}-self-${claimIndex}`,
            createdAt: receivedAt,
            scope: 'self' as const,
            recipient,
            shareMode,
            content: claim.text,
          })),
          ...familyClaims.map((claim, claimIndex) => ({
            id: `share-audit-${idSeed}-family-${claimIndex}`,
            createdAt: receivedAt,
            scope: 'family' as const,
            recipient,
            shareMode,
            content: claim.text,
          })),
        ]
      : [];

  const shareFamilyEventIds = intent === 'share_family' ? familyEventsToAppend.map((event) => event.id) : [];

  const incomingEvents: HealthEvent[] = [];
  for (let claimIndex = 0; claimIndex < acceptedClaims.length; claimIndex += 1) {
    const claim = acceptedClaims[claimIndex];
    if (!shouldPersistClaim(claim)) continue;
    const extractedValues = extractHealthValues(claim.text);
    const eventDate = claim.eventDate ?? today;
    incomingEvents.push(
      observationToEvent({
        id: `obs-live-${idSeed}-${claimIndex}`,
        date: eventDate,
        source: 'chat',
        text: claim.text,
        tags: claim.tags,
        // 显式把 status 传下去，让 safety.* 规则能用 hadOccurredObservation
        // 跳过"用户说没/假设/差点/不确定"的事件。shouldPersistClaim 已经
        // 保证 status==='occurred'，这里写出来是给入口和检测层之间的契约。
        status: claim.status,
        visibility,
        metadata: {
          sourceMessageId,
        },
      }),
    );
    for (const extracted of extractedValues) {
      incomingEvents.push(
        measurementToEvent({
          id: `chat-value-${idSeed}-${claimIndex}-${extracted.metric}`,
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
            sourceMessageId,
          },
        }),
      );
    }
  }

  // 没有可记录事件的分支（纯家属消息、澄清、召回、更正确认等）：
  // 回复保持旧版文本不变，整条作为主气泡。
  if (incomingEvents.length === 0) {
    const finalFamilyText = familyAcknowledgement || agentText;
    // P2 修复：混合意图（隐私请求 + 症状）在症状没被识别成事件时，隐私请求
    // 仍必须得到独立成行的显式回应，不能让"不要告诉孩子"这句话凭空消失。
    const earlyReplyBlocks: ChatMessageBlock[] = [{ kind: 'main', text: finalFamilyText }];
    if (intent === 'private') {
      earlyReplyBlocks.push({ kind: 'privacy', text: '好的，这部分不会告诉家属。' });
    }
    return {
      recordIntent: 'record',
      replyBlocks: earlyReplyBlocks,
      replyText: finalFamilyText,
      safetyAction: forceSafetyActions || hasUrgentFinding,
      correction,
      eventsToAppend: [],
      familyEventsToAppend,
      sharingAuditEntries,
      shareFamilyEventIds,
      shareFindingIds: [],
      medicationMissed: false,
      toast: finalFamilyText.replace(/\n/g, ' '),
    };
  }

  const values = acceptedClaims.flatMap((claim) => extractHealthValues(claim.text));
  const labels = acceptedTags.map(tagLabel);
  const valueText = values.map((item) => `${METRICS[item.metric].label} ${item.value}${item.unit}`);
  const recordSummary = [...labels, ...valueText].join('、');
  const timeNotice = acceptedClaims.some((claim) => claim.timeScope === 'yesterday' || claim.timeScope === 'lastNight')
    ? '按您说的时间归到昨晚/昨天，不当作今天新发生。'
    : '';
  const sharingNotice =
    intent === 'share_family'
      ? '这次只分享给家属一次，不会自动打开长期共享。'
      : intent === 'private'
        ? // P2 修复："这个不要告诉孩子，我最近胸口有点闷"这类混合意图，
          // 隐私请求必须被显式回应，而不是只给一句含糊的"只供您本人使用"。
          '好的，这部分不会告诉家属，只保存在您这台设备上。'
        : canShare
          ? '按您现在的授权，家属可以看到必要的变化。'
          : '这部分只供您本人使用。';
  const hasSafetyGuidance = acceptedTags.some((tag) => SAFETY_TAGS.has(tag));
  const safetyNotice =
    acceptedTags
      .map((tag) => SAFETY_NOTICES[tag])
      .filter((notice): notice is string => Boolean(notice))
      .join(' ') || '';
  const guidance = hasSafetyGuidance ? agentText : '';
  const selfSharingReceipt = canShare && recordSummary ? buildSelfSharingAcknowledgement(recordSummary, shareMode) : '';
  const sharingReceipt = familyAcknowledgement || selfSharingReceipt || sharingNotice;
  const correctionNotice = understanding.correction
    ? '已按您刚才的更正，只处理上一句话对应的事实；其他记录保持不变。'
    : '';
  const recordReceipt = recordSummary ? `我已经记下：${recordSummary}。${timeNotice}` : '';

  // replyText 与旧版单气泡拼接逐字一致；分块只是渲染结构的变化。
  const receiptParts = [
    guidance,
    correctionNotice,
    recordReceipt,
    safetyNotice && !guidance.includes(safetyNotice) ? safetyNotice : '',
    sharingReceipt,
  ].filter(Boolean);
  const replyText = receiptParts.join('\n');

  // 分块（评审 P1-5）：主气泡 = 安全指导 / 记录回执（无指导时）/ 兜底回答；
  // 更正回执、复测提醒与记录回执（已有主气泡时）降为小字回执；
  // 共享与隐私声明独立成行。
  const mainText = guidance || recordReceipt || agentText;
  const replyBlocks: ChatMessageBlock[] = [{ kind: 'main', text: mainText }];
  for (const receipt of [correctionNotice, recordReceipt, safetyNotice].filter(
    (part) => part && !mainText.includes(part),
  )) {
    replyBlocks.push({ kind: 'receipt', text: receipt });
  }
  replyBlocks.push({ kind: 'privacy', text: sharingReceipt });

  let shareFindingIds: string[] = [];
  if (intent === 'share_family') {
    const correctedEvents = correction
      ? removeCorrectedChatHealthEvents(events, correction.messageId, correction.tags)
      : events;
    const mergedForDetection = appendHealthEvents(correctedEvents, incomingEvents);
    shareFindingIds = runDetection(mergedForDetection, today)
      .filter(
        (finding) =>
          (finding.severity === 'alert' || finding.severity === 'urgent') &&
          finding.familyEligible !== false &&
          Boolean(finding.familyMessage),
      )
      .map((finding) => finding.id);
  }

  return {
    recordIntent: 'record',
    replyBlocks,
    replyText,
    safetyAction: forceSafetyActions || hasSafetyGuidance || hasUrgentFinding,
    correction,
    eventsToAppend: incomingEvents,
    familyEventsToAppend,
    sharingAuditEntries,
    shareFamilyEventIds,
    shareFindingIds,
    medicationMissed: acceptedTags.includes('medicationMissed'),
    toast: replyText.replace(/\n/g, ' '),
  };
}
