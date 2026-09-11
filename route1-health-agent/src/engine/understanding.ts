/** 用户输入的保守结构化理解层。 */
import type { ChatMessage, SymptomTag } from '../types';
import { parseElderInput } from './agent';
import { extractHealthValues } from './extract';
import { parsePrivacyIntent } from './privacy';
import { splitNaturalLanguageTexts } from './naturalLanguage';
import { resolveTime, type TimeScope } from './time';

export type ElderSubject = 'self' | 'spouse' | 'father' | 'mother' | 'family_other' | 'unknown';
export type ClaimStatus = 'occurred' | 'negated' | 'hypothetical' | 'near_miss' | 'uncertain';

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

const FAMILY_PATTERNS: Array<[ElderSubject, RegExp]> = [
  ['spouse', /(?:我老公|我丈夫|老公|丈夫|爱人|老伴)/],
  ['father', /(?:我爸|我父亲|爸爸|父亲)/],
  ['mother', /(?:我妈|我母亲|妈妈|母亲)/],
  ['family_other', /(?:儿子|女儿|哥哥|弟弟|姐姐|妹妹|爷爷|奶奶|外公|外婆|家里人|家人)/],
];
const THIRD_PERSON = /(?:他|她|他们|她们)/;
const SELF_EXPLICIT = [
  /(?:我自己|我本人|本人)/,
  /我的(?!爸|妈|父亲|母亲|老公|丈夫|爱人|老伴|儿子|女儿|哥哥|弟弟|姐姐|妹妹|爷爷|奶奶|外公|外婆|家人|家里人)/,
  /(?:^|[，。；、,;\s])我(?!爸|妈|父亲|母亲|老公|丈夫|爱人|老伴|儿子|女儿|哥哥|弟弟|姐姐|妹妹|爷爷|奶奶|外公|外婆|家人|家里人)/,
  /(?:后来|然后|今天|刚才|现在|这次|同时|而且|并且)我(?!爸|妈|父亲|母亲|老公|丈夫|爱人|老伴|儿子|女儿|哥哥|弟弟|姐姐|妹妹|爷爷|奶奶|外公|外婆|家人|家里人)/,
];
const PERCEPTION = /(?:觉得|看他|看她|看见|看到|发现|听见|听到|说他|说她|说他们|说她们)/;
const UNCERTAIN_WORDS = /(?:可能|好像|似乎|大概|估计|应该是|不太确定|不清楚|听说|怀疑)/;
const HYPOTHETICAL_WORDS = /(?:如果|假如|假设|万一|要是|倘若|会不会|怎么预防|怎么办才不会|有没有可能)/;
const NEGATION_WORDS = /(?:没有|没|未|未曾|从来没|从没|并没有|并未|不曾|否认|没有出现|没出现|没有发生|没发生|没感觉到|没有感觉到)/;
const NEAR_MISS_WORDS = /(?:差点|差一点|险些|险些就|几乎要|差点就)/;

function explicitFamilySubjects(text: string): ElderSubject[] {
  return [...new Set(FAMILY_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([subject]) => subject))];
}

function hasExplicitSelf(text: string): boolean {
  const familyTokens = /(?:我爸|我妈|我父亲|我母亲|我老公|我丈夫|我爱人|我老伴|我儿子|我女儿|我哥哥|我弟弟|我姐姐|我妹妹|我爷爷|我奶奶|我外公|我外婆|我家人|我家里人)/g;
  const withoutFamily = text.replace(familyTokens, '');
  return SELF_EXPLICIT.some((pattern) => pattern.test(withoutFamily));
}

function uniqueFamily(subjects: ElderSubject[]): ElderSubject[] {
  return [...new Set(subjects.filter((subject) => subject !== 'self' && subject !== 'unknown'))];
}

function inferSubject(text: string, priorSubjects: ElderSubject[], seenSubjects: ElderSubject[]): ElderSubject {
  const family = explicitFamilySubjects(text);
  const self = hasExplicitSelf(text);
  if (family.length > 1) return 'unknown';
  if (family.length === 1) return family[0];

  if (THIRD_PERSON.test(text)) {
    const context = uniqueFamily(seenSubjects.length > 0 ? seenSubjects : priorSubjects);
    if (context.length === 1) return context[0];
    if (self && PERCEPTION.test(text)) return 'family_other';
    return 'unknown';
  }

  const context = uniqueFamily(seenSubjects.length > 0 ? seenSubjects : priorSubjects);
  const omittedFamilyFollowUp =
    context.length === 1 &&
    !self &&
    /(?:后来|然后|今天|刚才|现在|这次|同时|而且|并且|也|还|同样|好多了|好一点|好些了|没那么|减轻|缓解)/.test(text);
  if (omittedFamilyFollowUp) return context[0];
  return 'self';
}

function statusFromText(text: string, tags: SymptomTag[], hasHealthValue: boolean): ClaimStatus {
  const hasHealthClaim = tags.length > 0 || hasHealthValue;
  if (hasHealthClaim && NEAR_MISS_WORDS.test(text)) return 'near_miss';
  if (hasHealthClaim && HYPOTHETICAL_WORDS.test(text)) return 'hypothetical';

  const improvement = /(?:不再|不怎么|没那么|没有那么|没有像|没有以前那么|比之前)/.test(text) &&
    /(?:喘|胸闷|疼|痛|头晕|肿|失眠|起夜|心慌|漏服|血压|心率|体重|睡)/.test(text);
  if (hasHealthClaim && NEGATION_WORDS.test(text) && !improvement) {
    if (tags.includes('medicationMissed') || tags.includes('poorSleep')) return 'occurred';
    return 'negated';
  }

  if (hasHealthClaim && (PERCEPTION.test(text) || UNCERTAIN_WORDS.test(text))) return 'uncertain';
  return 'occurred';
}

function recentFamilySubjects(messages: ChatMessage[]): ElderSubject[] {
  const result: ElderSubject[] = [];
  for (const message of [...messages].reverse().filter((item) => item.role === 'elder').slice(0, 4)) {
    for (const unit of splitNaturalLanguageTexts(message.text)) {
      const family = explicitFamilySubjects(unit);
      if (family.length === 1) result.push(family[0]);
    }
  }
  return result;
}

function isPureReassurance(text: string, tags: SymptomTag[], hasHealthValue: boolean): boolean {
  return tags.length === 0 && !hasHealthValue && /(?:没事|没什么事|没啥事|挺好的|好多了|好多了吧|放心吧|不用担心)/.test(text);
}

export function understandElderInput(
  text: string,
  today: string,
  recentMessages: ChatMessage[] = [],
): StructuredElderInput {
  const trimmed = text.trim();
  const recallRequested = /(我之前说啥|我之前说什么|刚才说了什么|前面说了什么|你还记得我说|我忘了我说)/.test(trimmed);
  const correction = /(说错了|弄错了|不是我|不是我本人|刚才不对)/.test(trimmed);
  if (recallRequested) return { claims: [], recallRequested, correction };

  const clarificationQuestion = /凶闷|胸闷[?？]$/.test(trimmed)
    ? '您说的“凶闷”是指“胸闷”吗？我先不把它当成确定症状记录。'
    : undefined;
  if (clarificationQuestion) return { claims: [], recallRequested, clarificationQuestion, correction };

  const priorSubjects = recentFamilySubjects(recentMessages);
  const claims: StructuredClaim[] = [];
  let seenSubjects = [...priorSubjects];
  let lastTags: SymptomTag[] = [];
  let lastHealthValue = false;

  for (const unit of splitNaturalLanguageTexts(trimmed)) {
    const parsed = parseElderInput(unit);
    const explicitTags = parsed.tags;
    const explicitValues = extractHealthValues(unit);
    const explicitHealthValue = explicitValues.length > 0;
    const subject = inferSubject(unit, priorSubjects, seenSubjects);

    const omittedComparison =
      explicitTags.length === 0 &&
      /(?:今天|现在|目前)/.test(unit) &&
      /(?:好多了|好一点|好些了|轻一点|减轻|缓解|没那么)/.test(unit) &&
      lastTags.length > 0;
    const omittedParallel =
      explicitTags.length === 0 &&
      /^(?:我|我自己|本人)也/.test(unit) &&
      lastTags.length > 0;

    const tags = explicitTags.length > 0
      ? explicitTags
      : omittedComparison || omittedParallel
        ? lastTags
        : [];
    const hasHealthValue = explicitHealthValue ||
      (tags.length > 0 && lastHealthValue && (omittedComparison || omittedParallel));
    const time = resolveTime(unit, today);
    const status = statusFromText(unit, tags, hasHealthValue);
    const deathReported = /(?:去世|过世|死了|死亡|没了)/.test(unit);

    if (isPureReassurance(unit, tags, hasHealthValue)) continue;

    if (deathReported) {
      claims.push({ text: unit, subject, status: 'uncertain', timeScope: time.scope, eventDate: time.eventDate, tags, hasHealthValue, outcome: 'death_reported' });
    } else if (subject === 'unknown' || tags.length > 0 || hasHealthValue || subject !== 'self' || status !== 'occurred') {
      claims.push({ text: unit, subject, status, timeScope: time.scope, eventDate: time.eventDate, tags, hasHealthValue });
    }

    if (subject !== 'self' && subject !== 'unknown') seenSubjects.push(subject);
    lastTags = tags;
    lastHealthValue = hasHealthValue;
  }

  const privacyIntents = splitNaturalLanguageTexts(trimmed)
    .map((unit) => parsePrivacyIntent(unit))
    .filter((intent) => intent !== 'none');
  const uniquePrivacy = [...new Set(privacyIntents)];
  if (uniquePrivacy.length > 1) {
    return {
      claims: [],
      recallRequested,
      clarificationQuestion: '我听到您对不同事情有不同的分享要求。为了不把您说的“不要告诉家属的内容”发出去，我先不自动记录或分享，请您把要分享的事情和不要分享的事情分开告诉我。',
      correction,
    };
  }

  const clarification = claims.some((claim) => claim.subject === 'unknown' && (claim.tags.length > 0 || claim.hasHealthValue))
    ? '您说的“他/她”可能是在说您自己，也可能是在说家人。我先确认清楚是指谁，再决定要不要记录。'
    : undefined;

  return { claims, recallRequested, clarificationQuestion: clarification, correction };
}

export function acceptedSelfClaims(input: StructuredElderInput): StructuredClaim[] {
  return input.claims.filter(
    (claim) => claim.subject === 'self' && claim.status === 'occurred' &&
      (claim.tags.length > 0 || claim.hasHealthValue) && claim.eventDate !== null,
  );
}

export function hasDeathReport(input: StructuredElderInput): boolean {
  return input.claims.some((claim) => claim.outcome === 'death_reported');
}
