/**
 * 用户输入的保守结构化理解层。
 *
 * 目的不是替代大模型，而是在“原话 -> 健康事实”之间增加一道确定性的事实接纳边界：
 * 人物、肯否、事件状态和时间不明确时，不允许关键词直接进入本人健康事件流。
 */
import type { ChatMessage, SymptomTag } from '../types';
import { parseElderInput } from './agent';
import { extractHealthValues } from './extract';
import { ASKS_FAMILY_RELAY, parsePrivacyIntent, TELLS_FAMILY } from './privacy';

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
    '(?:我老公|我丈夫|老公|丈夫|爱人|老伴|我爸|我父亲|爸爸|父亲|我妈|我母亲|妈妈|母亲|我自己|本人|儿子|女儿|哥哥|弟弟|姐姐|妹妹|爷爷|奶奶|外公|外婆|家里人|他|她|他们|她们)';
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

/**
 * “告诉女儿我头晕 / 跟女儿说今天走了六千步”里的称谓是信息接收人，不是健康事实主体；
 * 主体要看去掉接收人短语后的剩余部分：剩余部分点名家人 → 转述家人的事实，
 * 剩余部分省略主语（老人口语常态）→ 默认是老人本人。
 */
function subjectFromShareRecipient(clause: string): ElderSubject | null {
  const match = clause.match(/^(?:我)?(?:告诉|通知|跟|让).{0,2}\s*(?:孩子|女儿|儿子|家人|家里人|老伴|爱人|老公|丈夫)/);
  if (!match) return null;
  const remainder = clause.slice(match[0].length);
  const remainderKinships = new Set<ElderSubject>();
  if (/(?:我老公|我丈夫|老公|丈夫|爱人|老伴)/.test(remainder)) remainderKinships.add('spouse');
  if (/(?:我爸|我父亲|爸爸|父亲)/.test(remainder)) remainderKinships.add('father');
  if (/(?:我妈|我母亲|妈妈|母亲)/.test(remainder)) remainderKinships.add('mother');
  if (/(?:儿子|女儿|哥哥|弟弟|姐姐|妹妹|爷爷|奶奶|外公|外婆|家里人)/.test(remainder))
    remainderKinships.add('family_other');
  if (remainderKinships.size > 1) return 'unknown';
  if (remainderKinships.size === 1) return [...remainderKinships][0];
  if (/(?:我|我的|我自己|本人)/.test(remainder)) return 'self';
  if (/(?:他|她|他们|她们)/.test(remainder)) return 'unknown';
  return 'self';
}

function subjectFromText(clause: string, priorSubjects: ElderSubject[]): ElderSubject {
  // 分享句式判定必须先于多主体冲突检查：
  // “告诉女儿妈妈摔倒了”里女儿是接收人，唯一的健康事实主体是妈妈。
  const shareRecipientSubject = subjectFromShareRecipient(clause);
  if (shareRecipientSubject) return shareRecipientSubject;

  // 一个分句同时点名多个健康事实主体时，禁止把整句归给第一个匹配到的人。
  const explicitlyMentionedSubjects = new Set<ElderSubject>();
  if (/(我老公|我丈夫|老公|丈夫|爱人|老伴)/.test(clause)) explicitlyMentionedSubjects.add('spouse');
  if (/(我爸|我父亲|爸爸|父亲)/.test(clause)) explicitlyMentionedSubjects.add('father');
  if (/(我妈|我母亲|妈妈|母亲)/.test(clause)) explicitlyMentionedSubjects.add('mother');
  if (/(儿子|女儿|哥哥|弟弟|姐姐|妹妹|爷爷|奶奶|外公|外婆|家里人)/.test(clause))
    explicitlyMentionedSubjects.add('family_other');
  if (/(我自己|本人)/.test(clause)) explicitlyMentionedSubjects.add('self');
  if (explicitlyMentionedSubjects.size > 1) return 'unknown';

  // 在“告诉女儿我……”这类句子里，女儿是分享接收人，不是健康事实主体。
  if (/(?:告诉|通知|跟|让).{0,4}(?:女儿|儿子|孩子|家人).{0,6}(?:我|我的|我自己|本人)/.test(clause)) return 'self';

  if (/(我老公|我丈夫|老公|丈夫|爱人|老伴)/.test(clause)) return 'spouse';
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

function statusFromText(clause: string, tags: SymptomTag[], hasHealthValue: boolean): ClaimStatus {
  const semanticSymptomLanguage =
    /(心慌|心悸|摔倒|跌倒|喘|胸闷|胸痛|头晕|头昏|疼|痛|肿|失眠|睡不好|起夜|漏服|忘记吃|血压|心率|体重|气短|憋气)/.test(
      clause,
    );

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
    /(没|没有|未曾|从来没|并没有|不是).{0,5}(摔|跌|喘|胸闷|疼|痛|头晕|肿|失眠|起夜|漏服|忘记吃|血压|心率|体重|睡)/.test(
      clause,
    )
  )
    return 'negated';
  if (/(可能|好像|似乎|不太确定|不清楚)/.test(clause)) return 'uncertain';
  return 'occurred';
}

/**
 * 只识别那种"我现在的确没不舒服"式的纯自安式表达。
 * 一旦句子里带"也/当时/后来/然后/刚才/不过/但是/而且/如果"这类
 * 与其它事件/假设/转折有关的连接线索，就不当作自安，
 * 否则情感反应、历史事实、比较式改善都会被一起吞掉。
 */
function isPureSelfReassurance(clause: string): boolean {
  const trimmed = clause.trim().replace(/[。！!，,]+$/, '');
  if (/(?:也|当时|后来|然后|刚才|不过|但是|而且|并且|如果|万一|假如|要是|又)/.test(trimmed)) return false;
  if (!/(^我|^本人|^我自己|现在|目前|今天)/.test(trimmed)) return false;
  return /^(?:我|本人|我自己)?(?:现在|目前|今天)?(?:感觉|觉得|感到)?(?:没事|没什么|没什么事|没什么事情|还好|挺好|挺好的|好一些|好点了|好一点|好些)[了。！!,，]*$/.test(
    trimmed,
  );
}

/**
 * "说错了/弄错了/不是我..." 之类是撤销信号，不是健康事实。
 * 但只要它后面带了新主体或新症状，就交给正常解析流处理。
 */
function isPureCorrectionMarker(clause: string): boolean {
  const trimmed = clause.trim().replace(/[。！!，,]+$/, '');
  return /^(?:(?:刚才|刚刚|前面)?(?:说错了|弄错了|不对))|^(?:不是我(?:本人)?)$/.test(trimmed);
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
  const correction = /(说错了|弄错了|不是我|不是我本人|刚才不对|刚刚说错了|前面说错了)/.test(trimmed);
  const correctionTargetMessageId = correction
    ? [...recentMessages].reverse().find((message) => message.role === 'elder')?.id
    : undefined;
  let clarificationQuestion = /凶闷|胸闷[?？]$/.test(trimmed)
    ? '您说的“凶闷”是指“胸闷”吗？我先不把它当成确定症状记录。'
    : undefined;

  if (recallRequested || clarificationQuestion) {
    return { claims: [], recallRequested, clarificationQuestion, correction, correctionTargetMessageId };
  }

  const hasExplicitFamilyShare = TELLS_FAMILY.test(trimmed) || ASKS_FAMILY_RELAY.test(trimmed);
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

    // self + 无个人代词 + 无 tags/value + occurred 不是有意义事实。
    // 例: "那个2025年付过" 不应接收为本人事实。
    // 但 "我今天好多了" 有个人代词 + 时间状态应保留。
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

    // 最后推退口: 也要求 “self 不是真实事实” 时必须有个人代词。
    if (subject === 'self' && tags.length === 0 && !hasHealthValue && !hasFirstPerson) {
      // 仅跟踪 lastTags/lastHealthValue 使上下文继承能走通，但不推上事实流
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

  // 任何代词主体不明确都需要人工清请求明；
  // 不取决于是否含有安全规则/有值。
  const hasUnclearFamilyReference = claims.some((claim) => claim.subject === 'unknown');

  // 输入中仅含人名、事件、时间词等语义素但不含任何可识别的健康信息：提示清请求明以避免黑盒。
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
    clarificationQuestion: hasUnclearFamilyReference
      ? '\u60a8\u8bf4\u7684\u201c\u4ed6/\u5979\u201d\u53ef\u80fd\u662f\u5728\u8bf4\u60a8\u81ea\u5df1\uff0c\u4e5f\u53ef\u80fd\u662f\u5728\u8bf4\u5bb6\u4eba\u3002\u6211\u5148\u786e\u8ba4\u6e05\u695a\u662f\u6307\u8c01\uff0c\u518d\u51b3\u5b9a\u8981\u4e0d\u8981\u8bb0\u5f55\uff0c\u8fd9\u6837\u4e0d\u4f1a\u628a\u522b\u4eba\u7684\u60c5\u51b5\u8bb0\u5230\u60a8\u8fd9\u91cc\u3002'
      : (clarificationQuestion ?? undefined),
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
