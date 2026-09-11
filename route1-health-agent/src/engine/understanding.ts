/**
 * 用户输入的保守结构化理解层。
 *
 * 事实接纳边界：只有人物、状态、时间和数值足够明确的内容，才能进入本人健康事实流。
 * 本轮重点是人物归属：无法唯一确认“他/她/老伴”指向谁时，一律 unknown，不猜 self。
 */
import type { ChatMessage, SymptomTag } from '../types';
import { parseElderInput } from './agent';
import { extractHealthValues } from './extract';
import { parsePrivacyIntent } from './privacy';
import { splitNaturalLanguageTexts } from './naturalLanguage';
import { resolveTime, type TimeScope } from './time';

export type ElderSubject = 'self' | 'spouse' | 'father' | 'mother' | 'family_other' | 'unknown';
export type ClaimStatus = 'occurred' | 'negated' | 'hypothetical' | 'uncertain';

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

const SELF_PATTERNS = [/(?:我自己|我本人|本人|我的|我)(?:的)?/];
const SPOUSE_PATTERNS = [/(?:我老公|我丈夫|老公|丈夫|爱人|老伴)/];
const FATHER_PATTERNS = [/(?:我爸|我父亲|爸爸|父亲)/];
const MOTHER_PATTERNS = [/(?:我妈|我母亲|妈妈|母亲)/];
const OTHER_FAMILY_PATTERNS = [/(?:儿子|女儿|哥哥|弟弟|姐姐|妹妹|爷爷|奶奶|外公|外婆|家里人|家人)/];
const THIRD_PERSON_PRONOUN = /(?:他|她|他们|她们)/;

function matchesAny(clause: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(clause));
}

function explicitFamilySubjects(clause: string): ElderSubject[] {
  const subjects: ElderSubject[] = [];
  if (matchesAny(clause, SPOUSE_PATTERNS)) subjects.push('spouse');
  if (matchesAny(clause, FATHER_PATTERNS)) subjects.push('father');
  if (matchesAny(clause, MOTHER_PATTERNS)) subjects.push('mother');
  if (matchesAny(clause, OTHER_FAMILY_PATTERNS)) subjects.push('family_other');
  return [...new Set(subjects)];
}

function explicitSubject(clause: string): ElderSubject | null {
  const family = explicitFamilySubjects(clause);
  if (family.length === 1) return family[0];
  if (family.length > 1) return 'unknown';
  if (matchesAny(clause, SELF_PATTERNS)) return 'self';
  return null;
}

function uniqueFamilyContext(subjects: ElderSubject[]): ElderSubject[] {
  return [...new Set(subjects.filter((subject) => subject !== 'self' && subject !== 'unknown'))];
}

function inferPronounSubject(clause: string, priorSubjects: ElderSubject[]): ElderSubject | null {
  if (!THIRD_PERSON_PRONOUN.test(clause)) return null;

  const familyContext = uniqueFamilyContext(priorSubjects);
  if (familyContext.length === 1) return familyContext[0];
  return 'unknown';
}

function subjectFromText(clause: string, priorSubjects: ElderSubject[]): ElderSubject {
  // “告诉孩子我……”中的孩子是分享接收人，不是健康事实主体。
  if (/(?:告诉|通知|跟|让).{0,4}(?:女儿|儿子|孩子|家人).{0,6}(?:我|我的|我自己|本人)/.test(clause)) return 'self';

  const family = explicitFamilySubjects(clause);
  if (family.length > 1) return 'unknown';
  if (family.length === 1) return family[0];

  const pronounSubject = inferPronounSubject(clause, priorSubjects);
  if (pronounSubject) return pronounSubject;

  // 在老人聊天界面里，“昨晚没睡好”“今天头晕”这类无主语陈述默认是说话者本人。
  // 只有出现第三人称代词且没有唯一 antecedent 时，才进入 unknown。
  if (matchesAny(clause, SELF_PATTERNS) || !THIRD_PERSON_PRONOUN.test(clause)) return 'self';
  return 'unknown';
}

function subjectCandidatesForClause(clause: string, priorSubjects: ElderSubject[]): ElderSubject[] {
  const family = explicitFamilySubjects(clause);
  const hasSelf = matchesAny(clause, SELF_PATTERNS);
  const coordination = /(?:和|跟|以及|都|分别|各自|也)/.test(clause);

  if (family.length > 0 && hasSelf && coordination) return ['self', ...family];
  if (family.length > 1 && coordination) return family;

  const subject = subjectFromText(clause, priorSubjects);
  return [subject];
}

function statusFromText(clause: string, tags: SymptomTag[], hasHealthValue: boolean): ClaimStatus {
  if (/(如果|假如|万一|要是|怎么预防|怎么办才不会)/.test(clause) && (tags.length > 0 || hasHealthValue)) return 'hypothetical';

  if (tags.includes('medicationMissed') && /(没|没有|未|忘|漏).{0,6}(吃|服|用)?(?:了)?药/.test(clause)) return 'occurred';
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

  if (/(没|没有|未曾|从来没|并没有|不是).{0,5}(摔|跌|喘|胸闷|疼|痛|头晕|肿|失眠|起夜|漏服|忘记吃|血压|心率|体重|睡)/.test(clause)) {
    return 'negated';
  }
  if (/(可能|好像|似乎|不太确定|不清楚)/.test(clause) && (tags.length > 0 || hasHealthValue)) return 'uncertain';
  return 'occurred';
}

function recentPriorSubjects(messages: ChatMessage[]): ElderSubject[] {
  const subjects: ElderSubject[] = [];
  for (const message of [...messages].reverse().filter((item) => item.role === 'elder').slice(0, 4)) {
    for (const clause of splitNaturalLanguageTexts(message.text)) {
      const explicit = explicitSubject(clause);
      if (explicit && explicit !== 'unknown' && explicit !== 'self') subjects.push(explicit);
    }
  }
  return subjects;
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

  if (recallRequested || clarificationQuestion) return { claims: [], recallRequested, clarificationQuestion, correction };

  const priorSubjects = recentPriorSubjects(recentMessages);
  const claims: StructuredClaim[] = [];
  let subjectsSeen = [...priorSubjects];
  let lastTags: SymptomTag[] = [];
  let lastHealthValue = false;

  for (const clause of splitNaturalLanguageTexts(trimmed)) {
    const parsed = parseElderInput(clause);
    const explicitTags = parsed.tags;
    const hasExplicitHealthValue = extractHealthValues(clause).length > 0;
    const subjects = subjectCandidatesForClause(clause, subjectsSeen);
    const primarySubject = subjects.length === 1 ? subjects[0] : 'unknown';

    const isOmittedComparison =
      explicitTags.length === 0 &&
      /(今天|现在|目前)/.test(clause) &&
      /(好多了|好一点|好些了|轻一点|减轻|缓解|没那么)/.test(clause) &&
      lastTags.length > 0;
    const isOmittedParallelAction =
      explicitTags.length === 0 &&
      /^(?:我|我自己|本人)(?:也|还|同样)(?:没|没有|未|忘|漏|吃|服|用|量|测|测了|睡)/.test(clause) &&
      lastTags.length > 0;
    const tags = explicitTags.length > 0 ? explicitTags : isOmittedComparison || isOmittedParallelAction ? lastTags : [];
    const hasHealthValue =
      hasExplicitHealthValue ||
      (tags.length > 0 && lastHealthValue && (isOmittedComparison || isOmittedParallelAction));
    const time = resolveTime(clause, today);
    const status = statusFromText(clause, tags, hasHealthValue);
    const deathReported = /(去世|过世|死了|死亡|没了)/.test(clause);

    if (deathReported) {
      claims.push({
        text: clause,
        subject: primarySubject,
        status: 'uncertain',
        timeScope: time.scope,
        eventDate: time.eventDate,
        tags,
        hasHealthValue,
        outcome: 'death_reported',
      });
      subjectsSeen.push(...subjects.filter((subject) => subject !== 'unknown' && subject !== 'self'));
      lastTags = tags;
      lastHealthValue = hasHealthValue;
      continue;
    }

    if (subjects.length > 1 && subjects.every((subject) => subject !== 'unknown')) {
      for (const subject of subjects) {
        claims.push({ text: clause, subject, status, timeScope: time.scope, eventDate: time.eventDate, tags, hasHealthValue });
      }
      subjectsSeen.push(...subjects.filter((subject) => subject !== 'self'));
      lastTags = tags;
      lastHealthValue = hasHealthValue;
      continue;
    }

    if (tags.length === 0 && !hasHealthValue && primarySubject !== 'self' && primarySubject !== 'unknown') {
      claims.push({ text: clause, subject: primarySubject, status, timeScope: time.scope, eventDate: time.eventDate, tags, hasHealthValue });
      subjectsSeen.push(primarySubject);
      lastTags = tags;
      lastHealthValue = hasHealthValue;
      continue;
    }

    if (tags.length === 0 && !hasHealthValue && primarySubject !== 'unknown') {
      subjectsSeen.push(primarySubject);
      lastTags = tags;
      lastHealthValue = hasHealthValue;
      continue;
    }

    claims.push({ text: clause, subject: primarySubject, status, timeScope: time.scope, eventDate: time.eventDate, tags, hasHealthValue });
    subjectsSeen.push(...subjects.filter((subject) => subject !== 'unknown' && subject !== 'self'));
    lastTags = tags;
    lastHealthValue = hasHealthValue;
  }

  const hasUnclearFamilyReference = claims.some(
    (claim) => claim.subject === 'unknown' && (claim.tags.length > 0 || claim.hasHealthValue),
  );
  const privacyIntents = splitNaturalLanguageTexts(trimmed)
    .map((clause) => parsePrivacyIntent(clause))
    .filter((intent) => intent !== 'none');
  const uniquePrivacyIntents = [...new Set(privacyIntents)];

  if (uniquePrivacyIntents.length > 1) {
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
