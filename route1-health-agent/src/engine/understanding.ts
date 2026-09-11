/**
 * 用户输入的保守结构化理解层。
 *
 * 目的不是替代大模型，而是在“原话 -> 健康事实”之间增加一道确定性的事实接纳边界：
 * 人物、肯否、事件状态和时间不明确时，不允许关键词直接进入本人健康事件流。
 */
import type { ChatMessage, SymptomTag } from '../types';
import { parseElderInput } from './agent';
import { extractHealthValues } from './extract';
import { parsePrivacyIntent } from './privacy';

export type ElderSubject = 'self' | 'spouse' | 'father' | 'mother' | 'family_other' | 'unknown';
export type ClaimStatus = 'occurred' | 'negated' | 'hypothetical' | 'uncertain' | 'near_miss';
export type TimeScope = 'today' | 'yesterday' | 'lastNight' | 'historical' | 'unknown';

export interface StructuredClaim {
  text: string;
  subject: ElderSubject;
  status: ClaimStatus;
  timeScope: TimeScope;
  eventDate: string | null;
  tags: SymptomTag[];
  hasHealthValue: boolean;
  outcome?: 'death_reported';
}

export interface StructuredElderInput {
  claims: StructuredClaim[];
  recallRequested: boolean;
  clarificationQuestion?: string;
  correction: boolean;
  correctionTargetMessageId?: string;
}

function subtractDays(today: string, days: number): string {
  return new Date(Date.parse(today) - days * 86400000).toISOString().slice(0, 10);
}

/** 老人真实口语里的“顺带一提”非常常见：普通逗号后也可能开始一条新事实。 */
function splitClauses(text: string): string[] {
  const protectedNumericComma = text
    .replace(/([0-9零〇一二两三四五六七八九十百]+)\s*[,，]\s*(?=[0-9零〇一二两三四五六七八九十百]+)/g, '$1§NUM§')
    .replace(
      /((?:高压|低压|收缩压|舒张压)\s*(?:[0-9零〇一二两三四五六七八九十百]+))\s*[,，]\s*(?=(?:高压|低压|收缩压|舒张压))/g,
      '$1§NUM§',
    )
    .replace(/[,，](?=\s*(?:也(?:没|没有|未)|并(?:没|没有)|幸好|好在))/g, '§KEEP§');

  const explicitSubjectStart =
    '(?:我老公|我丈夫|老公|丈夫|爱人|我爸|我父亲|爸爸|父亲|我妈|我母亲|妈妈|母亲|我自己|本人|儿子|女儿|哥哥|弟弟|姐姐|妹妹|爷爷|奶奶|外公|外婆|家里人|他|她|他们|她们)';
  const implicitBoundary = protectedNumericComma.replace(
    new RegExp(`(?:然后|接着|另外|此外|同时|不过|但是|而且|还有)\\s*(?=${explicitSubjectStart})`, 'g'),
    '§CLAUSE§',
  );

  return implicitBoundary
    .split(/[。！？!?；;,，\n]+|§CLAUSE§+/)
    .map((clause) =>
      clause
        .replace(/§NUM§/g, ',')
        .replace(/§KEEP§/g, ',')
        .trim(),
    )
    .filter(Boolean);
}

function inferPronounSubject(clause: string, priorSubjects: ElderSubject[]): ElderSubject | null {
  if (!/(他|她|他们|她们)/.test(clause)) return null;

  // “我觉得/我看/我担心/我发现 + 他/她……”是典型的“我”作说话者、
  // 但健康事实属于第三人称的口语结构，不能被“我”抢先归类成 self。
  if (/我(?:觉得|看|担心|发现|注意到|看到|听说|感觉)[，,\s]*(?:他|她|他们|她们)/.test(clause)) {
    const unique = [...new Set(priorSubjects.filter((subject) => subject !== 'self' && subject !== 'unknown'))];
    if (unique.length === 1) return unique[0];
    return 'family_other';
  }

  if (/^(?:他|她|他们|她们)/.test(clause)) {
    const unique = [...new Set(priorSubjects.filter((subject) => subject !== 'self' && subject !== 'unknown'))];
    if (unique.length === 1) return unique[0];
    return 'unknown';
  }

  return null;
}

function subjectFromText(clause: string, priorSubjects: ElderSubject[]): ElderSubject {
  // 一个分句同时点名多个健康事实主体时，禁止把整句归给第一个匹配到的人。
  const explicitlyMentionedSubjects = new Set<ElderSubject>();
  if (/(我老公|我丈夫|老公|丈夫|爱人)/.test(clause)) explicitlyMentionedSubjects.add('spouse');
  if (/(我爸|我父亲|爸爸|父亲)/.test(clause)) explicitlyMentionedSubjects.add('father');
  if (/(我妈|我母亲|妈妈|母亲)/.test(clause)) explicitlyMentionedSubjects.add('mother');
  if (/(儿子|女儿|哥哥|弟弟|姐姐|妹妹|爷爷|奶奶|外公|外婆|家里人)/.test(clause))
    explicitlyMentionedSubjects.add('family_other');
  if (/(我自己|本人)/.test(clause)) explicitlyMentionedSubjects.add('self');
  if (explicitlyMentionedSubjects.size > 1) return 'unknown';

  // 在“告诉女儿我……”这类句子里，女儿是分享接收人，不是健康事实主体。
  if (/(?:告诉|通知|跟|让).{0,4}(?:女儿|儿子|孩子|家人).{0,6}(?:我|我的|我自己|本人)/.test(clause)) return 'self';

  if (/(我老公|我丈夫|老公|丈夫|爱人)/.test(clause)) return 'spouse';
  if (/(我爸|我父亲|爸爸|父亲)/.test(clause)) return 'father';
  if (/(我妈|我母亲|妈妈|母亲)/.test(clause)) return 'mother';
  if (/(儿子|女儿|哥哥|弟弟|姐姐|妹妹|爷爷|奶奶|外公|外婆|家里人)/.test(clause)) return 'family_other';

  const pronounSubject = inferPronounSubject(clause, priorSubjects);
  if (pronounSubject) return pronounSubject;

  // 只在确认当前句没有第三人称指向后，才让“我”决定主体。
  if (/(我|我的|我自己|本人)/.test(clause)) return 'self';

  const lastKnownSubject = [...priorSubjects].reverse().find((subject) => subject !== 'unknown');
  if (lastKnownSubject) return lastKnownSubject;

  return 'self';
}

/**
 * 跨轮主体记忆只允许继承“最近一轮 + 健康语义明确 + 唯一家庭主体”这一最小安全条件。
 *
 * 不能把几轮以前提过的爸爸/妈妈继续当作当前“他/她”的默认指代，也不能把同一轮中
 * 的多个家庭成员压缩成一个主体。失败时返回空上下文，让本轮代词进入 clarification。
 */
function recentPriorSubjects(messages: ChatMessage[]): ElderSubject[] {
  const latestElderMessage = [...messages].reverse().find((message) => message.role === 'elder');
  if (!latestElderMessage) return [];

  const establishedSubjects = splitClauses(latestElderMessage.text).map((clause) => {
    const parsed = parseElderInput(clause);
    const hasHealthValue = extractHealthValues(clause).length > 0;
    const hasHealthSemantic = parsed.tags.length > 0 || hasHealthValue;
    return {
      subject: subjectFromText(clause, []),
      hasHealthSemantic,
    };
  });

  if (!establishedSubjects.some((entry) => entry.hasHealthSemantic)) return [];

  const uniqueSubjects: ElderSubject[] = [];
  for (const entry of establishedSubjects) {
    if (!uniqueSubjects.includes(entry.subject)) uniqueSubjects.push(entry.subject);
  }

  if (uniqueSubjects.length !== 1) return [];
  const subject: ElderSubject = uniqueSubjects[0]!;
  if (subject === 'self' || subject === 'unknown') return [];
  return [subject];
}

export function understandElderInput(
  text: string,
  today: string,
  recentMessages: ChatMessage[] = [],
): StructuredElderInput {
  const trimmed = text.trim();
  const recallRequested = /(我之前说啥|我之前说什么|刚才说了什么|前面说了什么|你还记得我说|我忘了我说)/.test(trimmed);
  const correction = /(说错了|弄错了|不是我|不是我本人|刚才不对|刚刚说错了|前面说错了)/.test(trimmed);
  const correctionTargetMessageId = correction
    ? [...recentMessages].reverse().find((message) => message.role === 'elder')?.id
    : undefined;
  const clarificationQuestion = /凶闷|胸闷[?？]$/.test(trimmed)
    ? '您说的“凶闷”是指“胸闷”吗？我先不把它当成确定症状记录。'
    : undefined;

  if (recallRequested || clarificationQuestion) {
    return { claims: [], recallRequested, clarificationQuestion, correction, correctionTargetMessageId };
  }

  const hasExplicitFamilyShare = /(?:告诉|通知|跟|让).{0,4}(?:孩子|女儿|儿子|家人).{0,3}(?:知道|说|讲)?/.test(trimmed);
  const hasExplicitFamilyRefusal =
    /(?:不要|别|不想|不希望|不愿意|不愿|不需要).{0,4}(?:告诉|让|通知).{0,3}(?:孩子|女儿|儿子|家人|他|她|他们|她们)/.test(
      trimmed,
    ) ||
    /(?:不想|不希望|不愿意|不愿|不需要).{0,2}(?:让|叫)?(?:孩子|女儿|儿子|家人).{0,3}(?:知道|看见)/.test(trimmed) ||
    /不想让.{0,3}(?:孩子|女儿|儿子|家人).{0,3}(?:知道|看见|知道这件事)/.test(trimmed);
  if (hasExplicitFamilyShare && hasExplicitFamilyRefusal && parsePrivacyIntent(trimmed) === 'private') {
    return {
      claims: [],
      recallRequested,
      clarificationQuestion:
        '我听到您对不同事情有不同的分享要求。为了不把您说的“不要告诉家属的内容”发出去，我先不自动记录或分享，请您把要分享的事情和不要分享的事情分开告诉我。',
      correction,
      correctionTargetMessageId,
    };
  }

  const priorSubjects = recentPriorSubjects(recentMessages);
  const claims: StructuredClaim[] = [];
  let subjectsSeen = [...priorSubjects];
  let lastTags: SymptomTag[] = [];
  let lastHealthValue = false;

  for (const clause of splitClauses(trimmed)) {
    const parsed = parseElderInput(clause);
    const explicitTags = parsed.tags;
    const hasExplicitHealthValue = extractHealthValues(clause).length > 0;
    const subject = subjectFromText(clause, subjectsSeen);
    const isOmittedComparison =
      explicitTags.length === 0 &&
      /(今天|现在|目前)/.test(clause) &&
      /(好多了|好一点|好些了|轻一点|减轻|缓解|没那么)/.test(clause) &&
      lastTags.length > 0;
    const isOmittedParallelAction =
      explicitTags.length === 0 &&
      /^(?:我|我自己|本人)(?:也|还|同样)(?:没|没有|未|忘|漏|吃|服|用|量|测|测了|睡)/.test(clause) &&
      lastTags.length > 0;
    const tags =
      explicitTags.length > 0 ? explicitTags : isOmittedComparison || isOmittedParallelAction ? lastTags : explicitTags;
    const hasHealthValue: boolean =
      hasExplicitHealthValue ||
      (tags.length > 0 && lastHealthValue && (isOmittedComparison || isOmittedParallelAction));
    const time = timeFromText(clause, today);
    const status = statusFromText(clause, tags, hasHealthValue);
    const deathReported = /(去世|过世|死了|死亡|没了)/.test(clause);

    if (deathReported) {
      claims.push({
        text: clause,
        subject,
        status: 'uncertain',
        timeScope: time.scope,
        eventDate: time.eventDate,
        tags,
        hasHealthValue,
        outcome: 'death_reported',
      });
      subjectsSeen.push(subject);
      lastTags = tags;
      lastHealthValue = hasHealthValue;
      continue;
    }

    if (tags.length === 0 && !hasHealthValue && subject !== 'self' && subject !== 'unknown') {
      claims.push({
        text: clause,
        subject,
        status,
        timeScope: time.scope,
        eventDate: time.eventDate,
        tags,
        hasHealthValue,
      });
      subjectsSeen.push(subject);
      lastTags = tags;
      lastHealthValue = hasHealthValue;
      continue;
    }

    if (tags.length === 0 && !hasHealthValue && subject !== 'unknown' && status === 'occurred') {
      subjectsSeen.push(subject);
      lastTags = tags;
      lastHealthValue = hasHealthValue;
      continue;
    }

    claims.push({
      text: clause,
      subject,
      status,
      timeScope: time.scope,
      eventDate: time.eventDate,
      tags,
      hasHealthValue,
    });
    subjectsSeen.push(subject);
    lastTags = tags;
    lastHealthValue = hasHealthValue;
  }

  const hasUnclearFamilyReference = claims.some(
    (claim) => claim.subject === 'unknown' && (claim.tags.length > 0 || claim.hasHealthValue),
  );

  return {
    claims,
    recallRequested,
    clarificationQuestion: hasUnclearFamilyReference
      ? '您说的“他/她”可能是在说您自己，也可能是在说家人。我先确认清楚是指谁，再决定要不要记录，这样不会把别人的情况记到您这里。'
      : undefined,
    correction,
    correctionTargetMessageId,
  };
}

export function acceptedSelfClaims(input: StructuredElderInput): StructuredClaim[] {
  return input.claims.filter(
    (claim) =>
      claim.subject === 'self' &&
      claim.status === 'occurred' &&
      (claim.tags.length > 0 || claim.hasHealthValue) &&
      claim.eventDate !== null,
  );
}

export function hasDeathReport(input: StructuredElderInput): boolean {
  return input.claims.some((claim) => claim.outcome === 'death_reported');
}
