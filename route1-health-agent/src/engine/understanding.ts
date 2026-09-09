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
export type ClaimStatus = 'occurred' | 'negated' | 'hypothetical' | 'uncertain';
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
}

function subtractDays(today: string, days: number): string {
  return new Date(Date.parse(today) - days * 86400000).toISOString().slice(0, 10);
}

/** 老人真实口语里的“顺带一提”非常常见：普通逗号后也可能开始一条新事实。 */
function splitClauses(text: string): string[] {
  return text
    .split(/[。！？!?；;，,\n]+/)
    .map((clause) => clause.trim())
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
    return unique.length > 1 ? 'unknown' : 'family_other';
  }

  return null;
}

function subjectFromText(clause: string, priorSubjects: ElderSubject[]): ElderSubject {
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

function timeFromText(clause: string, today: string): { scope: TimeScope; eventDate: string | null } {
  if (/(去年|上个月|以前|之前|多年前|小时候)/.test(clause)) return { scope: 'historical', eventDate: null };
  if (/(昨晚|昨天晚上|昨天夜里|昨夜)/.test(clause)) return { scope: 'lastNight', eventDate: subtractDays(today, 1) };

  const hasToday = /(今天|刚才|刚刚|现在|目前)/.test(clause);
  const hasYesterday = /(昨天|昨日)/.test(clause);
  const currentComparison =
    hasToday &&
    hasYesterday &&
    /(比|像|不如|没有.{0,8}(像|那么|这么|那样)|好一点|好多了|好些了|轻一点|减轻|缓解|没那么)/.test(clause);

  if (currentComparison || (hasToday && !hasYesterday)) return { scope: 'today', eventDate: today };
  if (hasYesterday) return { scope: 'yesterday', eventDate: subtractDays(today, 1) };

  return { scope: 'today', eventDate: today };
}

function statusFromText(clause: string, tags: SymptomTag[], hasHealthValue: boolean): ClaimStatus {
  if (/(如果|假如|万一|要是|怎么预防|怎么办才不会)/.test(clause) && (tags.length > 0 || hasHealthValue)) {
    return 'hypothetical';
  }

  // “没吃药/没服药/忘了吃药”表达的是已经发生的用药遗漏，
  // 虽然表面有否定词，但业务事件本身是“漏服药物”而不是“没有漏服”。
  if (tags.includes('medicationMissed') && /(没|没有|未|忘|漏).{0,6}(吃|服|用)?(?:了)?药/.test(clause)) {
    return 'occurred';
  }

  // “没睡好”含有口语否定词，但它表达的是已经发生的睡眠问题。
  if (tags.includes('poorSleep') && /没睡好/.test(clause)) return 'occurred';

  // 比较/缓解结构不是“完全没有症状”。
  const comparativeImprovement =
    /(今天|现在|目前)/.test(clause) &&
    /(没|没有|不再|不那么)/.test(clause) &&
    /(像|那么|这么|那样|比)/.test(clause) &&
    /(喘|胸闷|疼|痛|头晕|肿|失眠|起夜|漏服|忘记吃|血压|心率|体重|睡)/.test(clause);
  if (comparativeImprovement && (tags.length > 0 || hasHealthValue)) return 'occurred';
  if (
    /(今天|现在|目前)/.test(clause) &&
    /(好多了|好一点|好些了|轻一点|减轻|缓解|没那么)/.test(clause) &&
    tags.length > 0
  ) {
    return 'occurred';
  }

  if (
    /(没|没有|未曾|从来没|并没有|不是).{0,5}(摔|跌|喘|胸闷|疼|痛|头晕|肿|失眠|起夜|漏服|忘记吃|血压|心率|体重|睡)/.test(
      clause,
    )
  ) {
    return 'negated';
  }
  if (/(可能|好像|似乎|不太确定|不清楚)/.test(clause) && (tags.length > 0 || hasHealthValue)) {
    return 'uncertain';
  }
  return 'occurred';
}

function recentPriorSubjects(messages: ChatMessage[]): ElderSubject[] {
  return [...messages]
    .reverse()
    .filter((message) => message.role === 'elder')
    .slice(0, 4)
    .flatMap((message) => splitClauses(message.text).map((clause) => subjectFromText(clause, [])));
}

export function understandElderInput(
  text: string,
  today: string,
  recentMessages: ChatMessage[] = [],
): StructuredElderInput {
  const trimmed = text.trim();
  const recallRequested = /(我之前说啥|我之前说什么|刚才说了什么|前面说了什么|你还记得我说|我忘了我说)/.test(trimmed);
  const correction = /(说错了|弄错了|不是我|不是我本人|刚才不对)/.test(trimmed);
  const clarificationQuestion = /凶闷|胸闷[?？]$/.test(trimmed)
    ? '您说的“凶闷”是指“胸闷”吗？我先不把它当成确定症状记录。'
    : undefined;

  if (recallRequested || clarificationQuestion) {
    return { claims: [], recallRequested, clarificationQuestion, correction };
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

    // 无健康标签但已经明确指向家属的分句不能被静默吞掉：它可能为后一个省略主语的
    // “摔了一下/喘起来了”建立人物上下文。它不会因为没有 tags 而进入本人健康记录。
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

    if (tags.length === 0 && !hasHealthValue && subject !== 'unknown') {
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
  const privacyIntents = splitClauses(trimmed)
    .map((clause) => parsePrivacyIntent(clause))
    .filter((intent) => intent !== 'none');
  const uniquePrivacyIntents = [...new Set(privacyIntents)];
  const hasMixedPrivacyIntent = uniquePrivacyIntents.length > 1;

  if (hasMixedPrivacyIntent) {
    return {
      claims: [],
      recallRequested,
      clarificationQuestion:
        '我听到您对不同事情有不同的分享要求。为了不把您说的“不要告诉家属的内容”发出去，我先不自动记录或分享，请您把要分享的事情和不要分享的事情分开告诉我。',
      correction,
    };
  }

  return {
    claims,
    recallRequested,
    clarificationQuestion: hasUnclearFamilyReference
      ? '您说的“他/她”可能是在说您自己，也可能是在说家人。我先确认清楚是指谁，再决定要不要记录，这样不会把别人的情况记到您这里。'
      : undefined,
    correction,
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
