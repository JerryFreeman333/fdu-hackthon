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
  /**
   * 撤销标签：从 correction 子句中解析出来的"用户在否认/撤掉"的症状标签。
   * 例如"刚才说错了，没有头晕" -> ['dizziness']。
   * 下游 removeCorrectedChatHealthEvents 只删除上一条消息中带这些标签的事件，
   * 而不是把整条消息的所有事件都抹掉。
   * 空数组 = 整条撤销（保留旧行为作为兜底）。
   */
  correctionTargetTags?: SymptomTag[];
}

function subtractDays(today: string, days: number): string {
  return new Date(Date.parse(today) - days * 86400000).toISOString().slice(0, 10);
}

/** 老人真实口语里的“顺带一提”非常常见：普通逗号后也可能开始一条新事实。 */
function splitClauses(text: string): string[] {
  const coordinatedMeasurementLeadPattern =
    /(?:我|本人|我自己)\s*(?:和|跟|与)\s*(?:我老公|我丈夫|老公|丈夫|爱人|老伴|我爸|我父亲|爸爸|父亲|我妈|我母亲|妈妈|母亲|儿子|女儿|哥哥|弟弟|姐姐|妹妹|爷爷|奶奶|外公|外婆|家里人)\s*(?:都|也).{0,24}(?:血压|血氧|心率|血糖)/;
  const hasCoordinatedMeasurementLead = coordinatedMeasurementLeadPattern.test(text);
  const coordinatedMeasurementCommaPattern = /[,，](?=\s*(?:一个|另一个|一人|另一个人|分别|各自))/g;
  const protectedNumericComma = text
    .replace(/([0-9零〇一二两三四五六七八九十百]+)\s*[,，]\s*(?=[0-9零〇一二三四五六七八九十百]+)/g, '$1§NUM§')
    .replace(
      /((?:高压|低压|收缩压|舒张压)\s*(?:[0-9零〇一二三四五六七八九十百]+))\s*[,，]\s*(?=(?:高压|低压|收缩压|舒张压))/g,
      '$1§NUM§',
    )
    .replace(
      /[,，](?=\s*(?:也(?:没|没有|未)|并(?:没|没有)|幸好|好在|(?:但|不过)\s*(?:不(?:太)?确定|不清楚|不知道|不算|不知道算|不知道算不算)))/g,
      '§KEEP§',
    );

  const protectedCoordinatedMeasurementComma = hasCoordinatedMeasurementLead
    ? protectedNumericComma.replace(coordinatedMeasurementCommaPattern, '§KEEP§')
    : protectedNumericComma;

  const explicitSubjectStart =
    '(?:我老公|我丈夫|老公|丈夫|爱人|老伴|我爸|我父亲|爸爸|父亲|我妈|我母亲|妈妈|母亲|我自己|本人|儿子|女儿|哥哥|弟弟|姐姐|妹妹|爷爷|奶奶|外公|外婆|家里人|他|她|他们|她们)';
  const implicitBoundary = protectedCoordinatedMeasurementComma.replace(
    new RegExp(`(?:然后|接着|另外|此外|同时|不过|但是|而且|还有)\s*(?=${explicitSubjectStart})`, 'g'),
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
  const explicitlyMentionedSubjects = new Set<ElderSubject>();
  if (/(我老公|我丈夫|老公|丈夫|爱人|老伴)/.test(clause)) explicitlyMentionedSubjects.add('spouse');
  if (/(我爸|我父亲|爸爸|父亲)/.test(clause)) explicitlyMentionedSubjects.add('father');
  if (/(我妈|我母亲|妈妈|母亲)/.test(clause)) explicitlyMentionedSubjects.add('mother');
  if (/(儿子|女儿|哥哥|弟弟|姐姐|妹妹|爷爷|奶奶|外公|外婆|家里人)/.test(clause))
    explicitlyMentionedSubjects.add('family_other');
  if (/(我自己|本人)/.test(clause)) explicitlyMentionedSubjects.add('self');
  if (explicitlyMentionedSubjects.size > 1) return 'unknown';

  if (/(?:告诉|通知|跟|让).{0,4}(?:女儿|儿子|孩子|家人).{0,6}(?:我|我的|我自己|本人)/.test(clause)) return 'self';

  if (/(我老公|我丈夫|老公|丈夫|爱人|老伴)/.test(clause)) return 'spouse';
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

function coordinatedSubjectsFromText(clause: string): ElderSubject[] | null {
  const match = clause.match(
    /^(?:我|本人|我自己)\s*(?:和|跟|与)\s*(我老公|我丈夫|老公|丈夫|爱人|老伴|我爸|我父亲|爸爸|父亲|我妈|我母亲|妈妈|母亲|儿子|女儿|哥哥|弟弟|姐姐|妹妹|爷爷|奶奶|外公|外婆|家里人)\s*(?:都|也)(?=\S)/,
  );
  if (!match) return null;
  const second = match[1];
  const subject: ElderSubject = /(我老公|我丈夫|老公|丈夫|爱人|老伴)/.test(second)
    ? 'spouse'
    : /(我爸|我父亲|爸爸|父亲)/.test(second)
      ? 'father'
      : /(我妈|我母亲|妈妈|母亲)/.test(second)
        ? 'mother'
        : 'family_other';
  return ['self', subject];
}

function hasAmbiguousCoordinatedMeasurement(clause: string, coordinatedSubjects: ElderSubject[]): boolean {
  if (coordinatedSubjects.length < 2) return false;
  const values = extractHealthValues(clause);
  const hasMeasurementLead = /(?:血压|血氧|心率|血糖)/.test(clause);
  const hasMultipleReadingMarkers = /(?:分别|各自|一个.{0,16}一个|一人.{0,16}一人)/.test(clause);
  if (values.length > 2) return true;
  if (hasMeasurementLead && hasMultipleReadingMarkers) return true;
  return hasMultipleReadingMarkers && values.length > 0;
}

function timeFromText(clause: string, today: string): { scope: TimeScope; eventDate: string | null } {
  if (/(去年|上个月|以前|之前|多年前|小时候|前几天|前两天|几天前|前些天|早些天|上回|上次|那次)/.test(clause))
    return { scope: 'historical', eventDate: null };
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

function isRhetoricalNegation(clause: string): boolean {
  const healthEventLanguage =
    /(心慌|心悸|摔倒|摔了|跌倒|跌了|喘|胸闷|胸痛|头晕|头昏|疼|痛|肿|失眠|睡不好|起夜|漏服|忘记吃|血压|心率|体重|气短|憋气)/;
  return (
    healthEventLanguage.test(clause) &&
    /(?:谁说|谁讲|哪有|哪里有|哪能有|才没有|根本没有|我(?:根本)?没有|我没(?:有)?|并没有)/.test(clause)
  );
}

function isStandaloneNegation(clause: string): boolean {
  const trimmed = clause.trim().replace(/[。！!，,？?]+$/, '');
  return (
    /^(?:(?:我|我自己|本人)\s*)?(?:(?:其实|不过|但是)\s*)?(?:没有|没|未|不是|才没有|才不是)(?:啊|呀|呢|的)?$/.test(
      trimmed,
    ) || /^(?:不是的|不是啊|不是呢)$/.test(trimmed)
  );
}

function tagMentionedInClause(clause: string, tags: SymptomTag[]): boolean {
  return tags.some((tag) => {
    if (tag === 'fall') return /(摔|跌倒|跌了|摔了|倒了)/.test(clause);
    if (tag === 'medicationMissed')
      return /(?:漏服|忘记吃|没吃|没服|没用).{0,6}药|药.{0,6}(?:没吃|没服|没用)/.test(clause);
    if (tag === 'poorSleep') return /(没睡好|睡不好|失眠)/.test(clause);
    if (tag === 'dyspnea') return /(喘|胸闷|气短|憋气)/.test(clause);
    if (tag === 'dizziness') return /(头晕|头昏|发黑|晕)/.test(clause);
    if (tag === 'chestPain') return /胸(?:口)?(?:痛|疼)|心口痛/.test(clause);
    if (tag === 'edema') return /肿|浮肿/.test(clause);
    if (tag === 'pain') return /疼|痛|不舒服|难受/.test(clause);
    if (tag === 'fatigue') return /累|乏|没劲/.test(clause);
    return false;
  });
}

function isImmediatePostposedDenial(clause: string, previous: StructuredClaim): boolean {
  if (previous.subject !== 'self' || previous.status !== 'occurred' || previous.tags.length === 0) return false;
  if (/(后来|之后|以后|现在|目前|已经|刚才|昨天|今天|明天|之前|以前)/.test(clause)) return false;
  if (!/^(?:(?:其实|不过|但是|而且|只是)\s*)?(?:没有|没|未|不是|并没有)/.test(clause.trim())) return false;
  if (/了(?:啊|呀|呢)?$/.test(clause.trim())) return false;
  return tagMentionedInClause(clause, previous.tags);
}

function statusFromText(clause: string, tags: SymptomTag[], hasHealthValue: boolean): ClaimStatus {
  const semanticSymptomLanguage =
    /(心慌|心悸|摔倒|跌倒|喘|胸闷|胸痛|头晕|头昏|疼|痛|肿|失眠|睡不好|起夜|漏服|忘记吃|血压|心率|体重|气短|憋气)/.test(
      clause,
    );

  if (isRhetoricalNegation(clause)) return 'negated';
  if (/(?:可能|好像|似乎|也许|大概|估计|说不定|不敢说|不(?:太)?确定|不清楚|不知道)/.test(clause)) return 'uncertain';

  if (
    /(如果|假如|万一|要是|怎么预防|怎么办才不会)/.test(clause) &&
    (tags.length > 0 || hasHealthValue || semanticSymptomLanguage)
  )
    return 'hypothetical';
  if (/(差点|差一点|差点儿|险些).{0,8}(摔|跌|撞|滑倒|晕倒)/.test(clause)) return 'near_miss';
  if (tags.includes('medicationMissed') && /(没|没有|未|忘|漏).{0,6}(吃|服|用)?(?:了)?药/.test(clause))
    return 'occurred';
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
  )
    return 'occurred';

  if (
    /(没|没有|未曾|从来没|并没有|不是).{0,5}(摔|跌|喘|胸闷|疼|痛|头晕|肿|失眠|起夜|漏服|忘记吃|血压|心率|体重|睡|不舒服|难受)/.test(
      clause,
    )
  )
    return 'negated';
  return 'occurred';
}

function isPureSelfReassurance(clause: string): boolean {
  const trimmed = clause.trim().replace(/[。！!，,]+$/, '');
  if (/(?:也|当时|后来|然后|刚才|不过|但是|而且|并且|如果|万一|假如|要是|又)/.test(trimmed)) return false;
  if (!/(^我|^本人|^我自己|现在|目前|今天)/.test(trimmed)) return false;
  return /^(?:我|本人|我自己)?(?:现在|目前|今天)?(?:感觉|觉得|感到)?(?:没事|没什么|没什么事|没什么事情|还好|挺好|挺好的|好一些|好点了|好一点|好些)[了。！!,，]*$/.test(
    trimmed,
  );
}

function isPureCorrectionMarker(clause: string): boolean {
  const trimmed = clause.trim().replace(/[。！!，,]+$/, '');
  return /^(?:(?:刚才|刚刚|前面)?(?:说错了|弄错了|不对))|^(?:不是我(?:本人)?)$/.test(trimmed);
}

function recentPriorSubjects(messages: ChatMessage[]): ElderSubject[] {
  const elderMessages = [...messages].reverse().filter((message) => message.role === 'elder');
  if (elderMessages.length === 0) return [];

  const familySubjects = new Set<ElderSubject>();
  let hasSelfHealthFact = false;
  let hasAmbiguousHealthFact = false;
  let sawHealthTurn = false;

  for (const message of elderMessages) {
    const sameTurnSubjects: ElderSubject[] = [];
    let turnHasHealthFact = false;

    for (const clause of splitClauses(message.text)) {
      const parsed = parseElderInput(clause);
      const hasHealthValue = extractHealthValues(clause).length > 0;
      const coordinatedSubjects = coordinatedSubjectsFromText(clause);
      const subject = coordinatedSubjects?.[0] ?? subjectFromText(clause, sameTurnSubjects);
      const status = statusFromText(clause, parsed.tags, hasHealthValue);
      const hasContextHealthLanguage =
        parsed.tags.length > 0 ||
        hasHealthValue ||
        /(喘|胸闷|胸痛|头晕|摔|跌|疼|痛|肿|不舒服|难受|血压|血氧|心率|血糖|走路不稳|没吃药|漏服|失眠|睡不好|睡不着|心慌|气短|憋气|跳)/.test(
          clause,
        );
      const isHealthFact = hasContextHealthLanguage && status !== 'hypothetical' && status !== 'uncertain';

      if (!isHealthFact) continue;
      turnHasHealthFact = true;

      if (coordinatedSubjects) {
        if (coordinatedSubjects.includes('self')) hasSelfHealthFact = true;
        if (coordinatedSubjects.some((coordinatedSubject) => coordinatedSubject !== 'self')) {
          familySubjects.add('unknown');
        }
        sameTurnSubjects.push(...coordinatedSubjects);
        continue;
      }

      sameTurnSubjects.push(subject);

      if (subject === 'self') {
        hasSelfHealthFact = true;
        continue;
      }
      if (subject === 'unknown') {
        hasAmbiguousHealthFact = true;
        continue;
      }
      familySubjects.add(subject);
    }

    if (!turnHasHealthFact) break;
    sawHealthTurn = true;

    if (hasSelfHealthFact || hasAmbiguousHealthFact || familySubjects.has('unknown') || familySubjects.size > 1)
      return [];
  }

  familySubjects.delete('unknown');
  if (!sawHealthTurn || hasSelfHealthFact || hasAmbiguousHealthFact || familySubjects.size !== 1) return [];
  return [...familySubjects];
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
  let correctionTargetTags: SymptomTag[] = [];
  if (correction) {
    for (const clause of splitClauses(trimmed)) {
      if (isPureCorrectionMarker(clause)) continue;
      const parsed = parseElderInput(clause);
      const status = statusFromText(clause, parsed.tags, extractHealthValues(clause).length > 0);
      if (status === 'occurred' || status === 'near_miss') continue;
      for (const tag of parsed.tags) {
        if (!correctionTargetTags.includes(tag)) correctionTargetTags.push(tag);
      }
    }
  }
  let clarificationQuestion = /凶闷|胸闷[?？]$/.test(trimmed)
    ? '您说的“凶闷”是指“胸闷”吗？我先不把它当成确定症状记录。'
    : undefined;

  if (recallRequested || clarificationQuestion) {
    return {
      claims: [],
      recallRequested,
      clarificationQuestion,
      correction,
      correctionTargetMessageId,
      correctionTargetTags,
    };
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
      correctionTargetTags,
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
    const explicitHealthValues = extractHealthValues(clause);
    const hasExplicitHealthValue = explicitHealthValues.length > 0;
    const coordinatedSubjects = coordinatedSubjectsFromText(clause);
    const hasAmbiguousMeasurementAssignment = coordinatedSubjects
      ? hasAmbiguousCoordinatedMeasurement(clause, coordinatedSubjects)
      : false;
    const subject = coordinatedSubjects?.[0] ?? subjectFromText(clause, subjectsSeen);
    const isOmittedComparison =
      explicitTags.length === 0 &&
      /(今天|现在|目前)/.test(clause) &&
      /(好多了|好一点|好些了|轻一点|减轻|缓解|没那么)/.test(clause) &&
      lastTags.length > 0;
    const isOmittedParallelAction =
      explicitTags.length === 0 &&
      /(?:^(?:我|我自己|本人)(?:也|还|同样)|(?:我老公|我丈夫|老公|丈夫|爱人|老伴|我爸|我父亲|爸爸|父亲|我妈|我母亲|妈妈|母亲|儿子|女儿|哥哥|弟弟|姐姐|妹妹|爷爷|奶奶|外公|外婆|家里人)(?:也|还|同样))/.test(
        clause,
      ) &&
      /(?:没|没有|未|忘|漏|吃|服|用|量|测|测了|睡)/.test(clause) &&
      lastTags.some((tag) => {
        if (tag === 'fall') return /(摔|跌|倒)/.test(clause);
        if (tag === 'medicationMissed') return /(?:吃|服|用|药)/.test(clause);
        if (tag === 'poorSleep') return /睡/.test(clause);
        if (tag === 'dyspnea') return /(喘|胸闷|气短|憋气)/.test(clause);
        if (tag === 'dizziness') return /(头晕|头昏|发黑|晕)/.test(clause);
        if (tag === 'chestPain') return /胸(?:口)?(?:痛|疼)|心口痛/.test(clause);
        if (tag === 'edema') return /肿|浮肿/.test(clause);
        if (tag === 'pain') return /疼|痛|不舒服/.test(clause);
        if (tag === 'fatigue') return /累|乏|没劲/.test(clause);
        return false;
      });
    const tags =
      explicitTags.length > 0 ? explicitTags : isOmittedComparison || isOmittedParallelAction ? lastTags : explicitTags;
    const hasHealthValue: boolean =
      hasExplicitHealthValue ||
      (tags.length > 0 && lastHealthValue && (isOmittedComparison || isOmittedParallelAction));
    const time = timeFromText(clause, today);
    const status = statusFromText(clause, tags, hasHealthValue);
    const deathReported = /(去世|过世|死了|死亡|没了)/.test(clause);

    if (coordinatedSubjects && hasAmbiguousMeasurementAssignment && !deathReported) {
      claims.push({
        text: clause,
        subject: 'unknown',
        status: 'uncertain',
        timeScope: time.scope,
        eventDate: time.eventDate,
        tags: [],
        hasHealthValue: false,
      });
      subjectsSeen.push('unknown');
      lastTags = [];
      lastHealthValue = false;
      continue;
    }

    if (coordinatedSubjects && (tags.length > 0 || hasHealthValue) && !deathReported) {
      for (const coordinatedSubject of coordinatedSubjects) {
        claims.push({
          text: clause,
          subject: coordinatedSubject,
          status,
          timeScope: time.scope,
          eventDate: time.eventDate,
          tags,
          hasHealthValue,
        });
      }
      subjectsSeen.push(...coordinatedSubjects);
      lastTags = tags;
      lastHealthValue = hasHealthValue;
      continue;
    }

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

    if (isPureCorrectionMarker(clause)) {
      subjectsSeen.push(subject);
      lastTags = tags;
      lastHealthValue = hasHealthValue;
      continue;
    }

    if (
      tags.length === 0 &&
      !hasHealthValue &&
      subject === 'self' &&
      status === 'occurred' &&
      isPureSelfReassurance(clause)
    ) {
      subjectsSeen.push(subject);
      lastTags = tags;
      lastHealthValue = hasHealthValue;
      continue;
    }

    const hasFirstPerson = /(我|本人|我自己)/.test(clause);
    if (
      tags.length === 0 &&
      !hasHealthValue &&
      subject !== 'unknown' &&
      status === 'occurred' &&
      (subject !== 'self' || hasFirstPerson)
    ) {
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

    if (subject === 'self' && tags.length === 0 && !hasHealthValue && !hasFirstPerson) {
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

  for (const clause of splitClauses(trimmed)) {
    const previous = [...claims]
      .reverse()
      .find(
        (claim) =>
          claim.subject === 'self' && claim.status === 'occurred' && (claim.tags.length > 0 || claim.hasHealthValue),
      );
    if (!previous) continue;
    if (isStandaloneNegation(clause) || isImmediatePostposedDenial(clause, previous)) previous.status = 'negated';
  }

  const hasUnclearFamilyReference = claims.some((claim) => claim.subject === 'unknown');
  const ambiguousCoordinatedMeasurement = claims.some(
    (claim) =>
      claim.subject === 'unknown' &&
      claim.status === 'uncertain' &&
      claim.tags.length === 0 &&
      !claim.hasHealthValue &&
      /(?:血压|血氧|心率|血糖)/.test(claim.text),
  );
  const hasAnyHealthSignal =
    /(血压|血氧|spo2|SPO2|SpO2|心跳|心率|血糖|跳|踩|痛|晕|发烧|睡|饮|仔子|心衰|肺|脑|不舒服|肚子|不舒)/.test(trimmed);
  const isGibberish =
    !hasAnyHealthSignal && !/(他|她|他们|她们)/.test(trimmed) && !/(中文数字|阿拉伯数字)/.test(trimmed);
  if (claims.length === 0 && !clarificationQuestion && !recallRequested && trimmed.length > 0 && isGibberish) {
    clarificationQuestion =
      '我没有听清您说的是什么。您是该该心跳、血压、血糖、血氧，还是某个具体的不舒服？请用常见的话说出来。';
  }
  return {
    claims,
    recallRequested,
    clarificationQuestion: ambiguousCoordinatedMeasurement
      ? '您这一句里有多个健康读数，但我还不能安全判断每个读数分别属于谁。我先不把这些数值记到任何人的健康档案，请分别告诉我“我是多少、家人是多少”。'
      : hasUnclearFamilyReference
        ? '您说的“他/她”可能是在说您自己，也可能是在说家人。我先确认清楚是指谁，再决定要不要记录，这样不会把别人的情况记到您这里。'
        : (clarificationQuestion ?? undefined),
    correction,
    correctionTargetMessageId,
    correctionTargetTags,
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
