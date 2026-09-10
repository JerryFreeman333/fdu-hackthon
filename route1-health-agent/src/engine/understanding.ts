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

/**
 * 老人真实口语里的“顺带一提”非常常见：普通逗号后也可能开始一条新事实。
 * 但逗号也可能只是血压的分隔符，例如“血压150,90”或“高压150，低压90”。
 * 因此先保护血压内部连接符，再按自然语言分句，避免上层理解重新破坏已解析的事实。
 * 逗号默认视为潜在的新 claim 边界，从而支持“我爸摔了，我也喘”这类同句多人物表达。
 * 同时把“但是/不过/可是”这类转折从同一 claim 中拆开，避免否定前半句时把后半句的真实症状一起否掉。
 */
function splitClauses(text: string): string[] {
  const protectedText = text
    .replace(
      /((?:血压|高压|收缩压|上压)\s*[0-9０-９一二两三四五六七八九十百千万零〇]+)[,，](\s*(?:低压|舒张压|下压)\s*[0-9０-９一二两三四五六七八九十百千万零〇]+)/g,
      '$1@@BP_COMMA@@$2',
    )
    .replace(
      /([0-9０-９一二两三四五六七八九十百千万零〇]+)[,，](?=[0-9０-９一二两三四五六七八九十百千万零〇]+)/g,
      '$1@@BP_COMMA@@',
    );

  return protectedText
    .split(/[。！？!?；;\n]+|[,，]+/)
    .flatMap((clause) => clause.split(/\s*(?=(?:但是|不过|可是))/))
    .map((clause) => clause.replace(/@@BP_COMMA@@/g, '，').trim())
    .map((clause) => clause.replace(/^(?:但是|不过|可是)\s*/, '').trim())
    .filter(Boolean);
}

function inferPronounSubject(clause: string, priorSubjects: ElderSubject[]): ElderSubject | null {
  if (!/(他|她|他们|她们)/.test(clause)) return null;

  if (/我(?:觉得|看|担心|发现|注意到|看到|听说|感觉)[，,\s]*(?:他|她|他们|她们)/.test(clause)) {
    const unique = [...new Set(priorSubjects.filter((subject) => subject !== 'self' && subject !== 'unknown'))];
    if (unique.length === 1) return unique[0];
    return 'unknown';
  }

  if (/^(?:他|她|他们|她们)/.test(clause)) {
    const unique = [...new Set(priorSubjects.filter((subject) => subject !== 'self' && subject !== 'unknown'))];
    return unique.length === 1 ? unique[0] : 'unknown';
  }

  return null;
}

function subjectFromText(clause: string, priorSubjects: ElderSubject[]): ElderSubject {
  if (/(?:告诉|通知|跟|让).{0,4}(?:女儿|儿子|孩子|家人).{0,6}(?:我|我的|我自己|本人)/.test(clause)) return 'self';

  if (/(我老公|我丈夫|老公|丈夫|爱人)/.test(clause)) return 'spouse';
  if (/(我爸|我父亲|爸爸|父亲)/.test(clause)) return 'father';
  if (/(我妈|我母亲|妈妈|母亲)/.test(clause)) return 'mother';
  if (/(儿子|女儿|哥哥|弟弟|姐姐|妹妹|爷爷|奶奶|外公|外婆|家里人)/.test(clause)) return 'family_other';

  const pronounSubject = inferPronounSubject(clause, priorSubjects);
  if (pronounSubject) return pronounSubject;

  if (/(我|我的|我自己|本人)/.test(clause)) return 'self';

  const lastKnownSubject = [...priorSubjects].reverse().find((subject) => subject !== 'unknown');
  if (lastKnownSubject) return lastKnownSubject;

  return 'self';
}

interface TimeResolution {
  scope: TimeScope;
  eventDate: string | null;
  explicit: boolean;
}

function timeFromText(clause: string, today: string): TimeResolution {
  if (/(去年|上个月|上周|前几天|以前|之前|多年前|小时候)/.test(clause)) {
    return { scope: 'historical', eventDate: null, explicit: true };
  }
  if (/(大前天)/.test(clause)) {
    return { scope: 'historical', eventDate: subtractDays(today, 3), explicit: true };
  }
  if (/(前天|两天前)/.test(clause)) {
    return { scope: 'historical', eventDate: subtractDays(today, 2), explicit: true };
  }
  if (/(三天前)/.test(clause)) {
    return { scope: 'historical', eventDate: subtractDays(today, 3), explicit: true };
  }
  if (/(昨晚|昨天晚上|昨天夜里|昨夜)/.test(clause)) {
    return { scope: 'lastNight', eventDate: subtractDays(today, 1), explicit: true };
  }

  const hasToday = /(今天|刚才|刚刚|现在|目前)/.test(clause);
  const hasYesterday = /(昨天|昨日)/.test(clause);
  const currentComparison =
    hasToday &&
    hasYesterday &&
    /(比|像|不如|没有.{0,8}(像|那么|这么|那样)|好一点|好多了|好些了|轻一点|减轻|缓解|没那么)/.test(clause);

  if (currentComparison || (hasToday && !hasYesterday)) {
    return { scope: 'today', eventDate: today, explicit: true };
  }
  if (hasYesterday) {
    return { scope: 'yesterday', eventDate: subtractDays(today, 1), explicit: true };
  }

  return { scope: 'today', eventDate: today, explicit: false };
}

function shouldInheritTime(
  clause: string,
  subject: ElderSubject,
  previousSubject: ElderSubject | null,
  previousTime: TimeResolution | null,
): boolean {
  if (!previousTime || previousTime.explicit === false) return false;
  if (subject === previousSubject) return true;
  return /^(?:后来|随后|之后|接着|然后|再|又|仍然|还是|一直)/.test(clause);
}

function statusFromText(clause: string, tags: SymptomTag[], hasHealthValue: boolean): ClaimStatus {
  if (/(如果|假如|万一|要是|怎么预防|怎么办才不会)/.test(clause) && (tags.length > 0 || hasHealthValue)) {
    return 'hypothetical';
  }

  if (/(差点|差一点|险些|险点|差点儿)/.test(clause) && (tags.length > 0 || hasHealthValue)) return 'uncertain';

  if (tags.includes('medicationMissed') && /(没|没有|未|忘|漏).{0,6}(吃|服|用)?(?:了)?药/.test(clause)) {
    return 'occurred';
  }
  if (tags.includes('poorSleep') && /没睡好/.test(clause)) return 'occurred';

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
  if (/(可能|好像|似乎|不太确定|不清楚)/.test(clause) && (tags.length > 0 || hasHealthValue)) return 'uncertain';
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
  let previousSubject: ElderSubject | null = null;
  let previousTime: TimeResolution | null = null;

  for (const clause of splitClauses(trimmed)) {
    const parsed = parseElderInput(clause);
    const explicitTags = parsed.tags;
    const hasExplicitHealthValue = extractHealthValues(clause).length > 0;
    const subject = subjectFromText(clause, subjectsSeen);
    const isOmittedParallelAction =
      explicitTags.length === 0 &&
      /^(?:我|我自己|本人)(?:也|还|同样)(?:没|没有|未|忘|漏|吃|服|用|量|测|测了|睡)/.test(clause) &&
      lastTags.length > 0;
    const tags = explicitTags.length > 0 ? explicitTags : isOmittedParallelAction ? lastTags : explicitTags;
    const hasHealthValue: boolean =
      hasExplicitHealthValue || (tags.length > 0 && lastHealthValue && isOmittedParallelAction);
    const rawTime = timeFromText(clause, today);
    const time = !rawTime.explicit && shouldInheritTime(clause, subject, previousSubject, previousTime)
      ? { ...previousTime, explicit: false }
      : rawTime;
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
      previousSubject = subject;
      previousTime = time;
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
      previousSubject = subject;
      previousTime = time;
      continue;
    }

    if (tags.length === 0 && !hasHealthValue && subject !== 'unknown') {
      subjectsSeen.push(subject);
      lastTags = tags;
      lastHealthValue = hasHealthValue;
      previousSubject = subject;
      previousTime = time;
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
    previousSubject = subject;
    previousTime = time;
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

export function hasDeathReport(input: StructuredElderInput): boolean {
  return input.claims.some((claim) => claim.outcome === 'death_reported');
}

export function acceptedSelfClaims(input: StructuredElderInput): StructuredClaim[] {
  return input.claims.filter(
    (claim) =>
      claim.subject === 'self' &&
      claim.status === 'occurred' &&
      claim.eventDate !== null &&
      (claim.tags.length > 0 || claim.hasHealthValue),
  );
}
