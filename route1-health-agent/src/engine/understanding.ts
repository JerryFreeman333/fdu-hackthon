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
  const protectedNumericComma = text
    .replace(/([0-9零〇一二两三四五六七八九十百]+)\s*[,，]\s*(?=[0-9零〇一二两三四五六七八九十百]+)/g, '$1§NUM§')
    .replace(
      /((?:高压|低压|收缩压|舒张压)\s*(?:[0-9零〇一二两三四五六七八九十百]+))\s*[,，]\s*(?=(?:高压|低压|收缩压|舒张压))/g,
      '$1§NUM§',
    )
    .replace(
      /[,，](?=\s*(?:也(?:没|没有|未)|并(?:没|没有)|幸好|好在|(?:但|不过)\s*(?:不(?:太)?确定|不清楚|不知道|不算|不知道算|不知道算不算)))/g,
      '§KEEP§',
    );

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

function subjectFromText(clause: string, priorSubjects: ElderSubject[]): ElderSubject {
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

/** “谁说我摔了”“哪有我胸痛”这类句式是在反驳前述事实，不是在报告事实。 */
function isRhetoricalNegation(clause: string): boolean {
  const healthEventLanguage =
    /(心慌|心悸|摔倒|摔了|跌倒|跌了|喘|胸闷|胸痛|头晕|头昏|疼|痛|肿|失眠|睡不好|起夜|漏服|忘记吃|血压|心率|体重|气短|憋气)/;
  return (
    healthEventLanguage.test(clause) &&
    /(?:谁说|谁讲|哪有|哪里有|哪能有|才没有|根本没有|我(?:根本)?没有|我没(?:有)?|并没有)/.test(clause)
  );
}

/** “我摔倒了，没有啊”“我摔倒了吗？没有”这种口语会被逗号/问号拆开；后一句需要回溯取消前一句。 */
function isStandaloneNegation(clause: string): boolean {
  const trimmed = clause.trim().replace(/[。！!，,？?]+$/, '');
  return /^(?:(?:我|我自己|本人)\s*)?(?:没有|没|未|不是|才没有|才不是)(?:啊|呀|呢|的)?$/.test(trimmed);
}

function statusFromText(clause: string, tags: SymptomTag[], hasHealthValue: boolean): ClaimStatus {
  const semanticSymptomLanguage =
    /(心慌|心悸|摔倒|跌倒|喘|胸闷|胸痛|头晕|头昏|疼|痛|肿|失眠|睡不好|起夜|漏服|忘记吃|血压|心率|体重|气短|憋气)/.test(
      clause,
    );

  if (isRhetoricalNegation(clause)) return 'negated';

  // 用户在话里自带"模棱两可"的语气词（可能 / 好像 / 似乎 / 不太确定 / 不清楚），
  // 表明他/她并不在断言事实。这类表达一律当作 uncertain，
  // 优先于 near_miss / "没吃药 / 没睡好" / 比较式改善 / 否定 等所有
  // "用户在报告已发生事实"的分支。即便同时存在"好像没睡好"这类组合，
  // 也不能被当作 occurred 进入本人事实流。
  //   "我可能没睡好"          -> uncertain（而不是 occurred / poorSleep）
  //   "我好像差点摔了"        -> uncertain（而不是 near_miss）
  //   "我好像没胸痛"          -> uncertain（而不是 negated）
  //   "我刚才差点摔倒，但不确定算不算" -> uncertain（而不是 near_miss）
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
    /(没|没有|未曾|从来没|并没有|不是).{0,5}(摔|跌|喘|胸闷|疼|痛|头晕|肿|失眠|起夜|漏服|忘记吃|血压|心率|体重|睡)/.test(
      clause,
    )
  )
    return 'negated';
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
  // 仅把"独立指向某人"的分句主体作为代词继承池。
  // 同一分句里若同时出现"我"+"老伴/爸/妈"等并列主体，那个人不能进入代词池，
  // 否则"我和老伴都喘"之后"他也喘"会被强行归给 spouse（issue ⑦ 修法）。
  return [...messages]
    .reverse()
    .filter((message) => message.role === 'elder')
    .slice(0, 4)
    .flatMap((message) =>
      splitClauses(message.text)
        // 只把"我和老伴"/"我也X"/"我跟他"这类把"我"作并列共主语的分句排除掉。
        // "我爸喘"/"我妈血压150"这种所有格形态的"我"不在排除范围——
        // 因为这里的"我"是所有格（my），实际主语是爸/妈，仍应作为代词继承候选。
        .filter((clause) => !/(?:我(?:和|跟|与|也|还|都|一起|俩|两人))/.test(clause))
        .map((clause) => subjectFromText(clause, [])),
    );
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
  // 解析"用户在撤销哪些症状"：用现有 parseElderInput 抽取 tags，然后
  // 只保留 status 为 negated/hypothetical/uncertain 的——这些都是用户
  // 在表达"撤回/假设/不确定"，而非新增事实。
  // 例：
  //   "刚才说错了，没有头晕"   -> 头晕是纠正目标
  //   "刚才说错了，血压没那么高" -> 没有具体标签（uncertain/negated），仍按整条撤销
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

  // 处理被逗号/问号拆开的“后置否认”：
  //   “我摔倒了，没有啊” / “我摔倒了吗？没有”
  // 后一句不是新健康事实，而是在撤销紧挨着的前一句事实。
  for (const clause of splitClauses(trimmed)) {
    if (!isStandaloneNegation(clause)) continue;
    const previous = [...claims]
      .reverse()
      .find(
        (claim) =>
          claim.subject === 'self' &&
          claim.status === 'occurred' &&
          (claim.tags.length > 0 || claim.hasHealthValue),
      );
    if (previous) previous.status = 'negated';
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
