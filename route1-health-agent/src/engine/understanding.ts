/**
 * 用户输入的保守结构化理解层。
 *
 * 目的不是替代大模型，而是在“原话 -> 健康事实”之间增加一道确定性的事实接纳边界：
 * 人物、肯否、事件状态和时间不明确时，不允许关键词直接进入本人健康事件流。
 */
import type { ChatMessage, SymptomTag } from '../types';
import { parseElderInput } from './agent';

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

function splitClauses(text: string): string[] {
  return text
    .split(/[。！？!?；;\n]+|，(?=(?:是|但|不过|而且|只是|其实))/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function subjectFromText(clause: string, priorSubjects: ElderSubject[]): ElderSubject {
  if (/(我老公|我丈夫|老公|丈夫|爱人)/.test(clause)) return 'spouse';
  if (/(我爸|我父亲|爸爸|父亲)/.test(clause)) return 'father';
  if (/(我妈|我母亲|妈妈|母亲)/.test(clause)) return 'mother';
  if (/(儿子|女儿|哥哥|弟弟|姐姐|妹妹|爷爷|奶奶|外公|外婆|家里人)/.test(clause)) return 'family_other';
  if (/(\b我\b|我的|我自己|本人)/.test(clause)) return 'self';
  if (/^(他|她|他们|她们)/.test(clause)) {
    const unique = [...new Set(priorSubjects.filter((subject) => subject !== 'self'))];
    return unique.length === 1 ? unique[0] : 'unknown';
  }
  return 'self';
}

function timeFromText(clause: string, today: string): { scope: TimeScope; eventDate: string | null } {
  if (/(去年|上个月|以前|之前|多年前|小时候)/.test(clause)) return { scope: 'historical', eventDate: null };
  if (/(昨晚|昨天晚上|昨天夜里|昨夜)/.test(clause)) return { scope: 'lastNight', eventDate: subtractDays(today, 1) };
  if (/(昨天|昨日)/.test(clause)) return { scope: 'yesterday', eventDate: subtractDays(today, 1) };
  if (/(今天|刚才|刚刚|现在|目前)/.test(clause)) return { scope: 'today', eventDate: today };
  return { scope: 'today', eventDate: today };
}

function statusFromText(clause: string, tags: SymptomTag[]): ClaimStatus {
  if (/(如果|假如|万一|要是|怎么预防|怎么办才不会)/.test(clause) && tags.length > 0) return 'hypothetical';
  if (/(没|没有|未曾|从来没|并没有|不是).{0,5}(摔|跌|喘|胸闷|疼|痛|头晕|肿|失眠|起夜|漏服|忘记吃)/.test(clause)) {
    return 'negated';
  }
  if (/(可能|好像|似乎|不太确定|不清楚)/.test(clause) && tags.length > 0) return 'uncertain';
  return 'occurred';
}

function recentPriorSubjects(messages: ChatMessage[]): ElderSubject[] {
  return [...messages]
    .reverse()
    .filter((message) => message.role === 'elder')
    .slice(0, 4)
    .flatMap((message) => splitClauses(message.text).map((clause) => subjectFromText(clause, [])));
}

export function understandElderInput(text: string, today: string, recentMessages: ChatMessage[] = []): StructuredElderInput {
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

  for (const clause of splitClauses(trimmed)) {
    const parsed = parseElderInput(clause);
    const tags = parsed.tags;
    const time = timeFromText(clause, today);
    const subject = subjectFromText(clause, subjectsSeen);
    const status = statusFromText(clause, tags);
    const deathReported = /(去世|过世|死了|死亡|没了)/.test(clause);

    if (deathReported) {
      claims.push({
        text: clause,
        subject,
        status: 'uncertain',
        timeScope: time.scope,
        eventDate: time.eventDate,
        tags,
        outcome: 'death_reported',
      });
      subjectsSeen.push(subject);
      continue;
    }

    if (tags.length === 0 && subject !== 'unknown') continue;
    claims.push({
      text: clause,
      subject,
      status,
      timeScope: time.scope,
      eventDate: time.eventDate,
      tags,
    });
    subjectsSeen.push(subject);
  }

  const hasUnclearFamilyReference = claims.some((claim) => claim.subject === 'unknown' && claim.tags.length > 0);
  return {
    claims,
    recallRequested,
    clarificationQuestion: hasUnclearFamilyReference
      ? '您说的“他/她”指的是谁？我先确认清楚，再决定要不要记录。'
      : undefined,
    correction,
  };
}

export function acceptedSelfClaims(input: StructuredElderInput): StructuredClaim[] {
  return input.claims.filter(
    (claim) => claim.subject === 'self' && claim.status === 'occurred' && claim.tags.length > 0 && claim.eventDate !== null,
  );
}

export function hasDeathReport(input: StructuredElderInput): boolean {
  return input.claims.some((claim) => claim.outcome === 'death_reported');
}
