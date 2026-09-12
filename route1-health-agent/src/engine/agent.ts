/** 对话 Agent：规则负责识别与安全边界，Adapter 负责最终措辞。 */
import type { ChatMessage, Finding, SymptomTag } from '../types';
import type { AgentContext } from './context';
import { SYMPTOM_LABELS } from '../types';
import { suggestFollowUpQuestions } from './questions';
import { parsePrivacyIntent } from './privacy';
import { extractHealthValues } from './extract';

interface IntentRule {
  tag: SymptomTag;
  patterns: RegExp[];
  replies: string[];
}

const INTENT_RULES: IntentRule[] = [
  {
    tag: 'fatigue',
    patterns: [/很?累/, /乏/, /没(有)?劲/, /提不起(精神|劲)/, /体力(不|跟不)上/, /腿(?:都|发)?软/],
    replies: ['先歇一歇，别硬撑。您如果愿意，可以告诉我这种累是从什么时候开始的。'],
  },
  {
    tag: 'dyspnea',
    patterns: [
      /喘/,
      /气(短|不够|促)/,
      /憋气/,
      /胸闷/,
      // P2 修复："胸口有点闷/胸口发闷"此前不产生任何标签，整句症状被静默丢弃
      // （评审现场："这个不要告诉孩子，我最近胸口有点闷" → 只得到解释文）。
      // 窗口限制在 4 字内、限定"胸"字开头，避免误收"心里闷"类情绪表达。
      /胸(?:口|部|口里)?[^。？\n]{0,4}闷/,
      /上(楼|台阶)(费劲|吃力|喘)/,
    ],
    replies: ['别着急，慢慢说。我先记下您现在说的感觉，可以再告诉我是静坐时还是活动时更明显。'],
  },
  {
    tag: 'poorSleep',
    patterns: [/睡不(好|着|踏实)/, /没睡好/, /失眠/, /夜醒/, /起夜/, /半夜(醒|起来)/],
    replies: ['睡不好确实难受，我记下了。我想再确认一个情况。'],
  },
  {
    tag: 'edema',
    patterns: [/(脚|腿|脚踝|小腿).{0,4}肿/, /肿了/, /鞋(紧|挤脚)/, /袜子(印|勒)/],
    replies: ['我记下了。脚踝或腿部的肿胀如果持续或越来越明显，建议尽快和医生沟通。'],
  },
  {
    tag: 'dizziness',
    // 兜底下限（主修复在理解层 LLM 仲裁）：窗口 {0,2}→{0,4} 覆盖"头一点都不晕"；
    // 否定语境的裸"晕"（不晕/没晕）单独补——正面裸"晕"刻意不收（晕车/晕船类误报面大）。
    patterns: [/头晕/, /头.{0,4}晕/, /头昏/, /(?:不|没(?:有)?|未)晕/, /站不稳/, /眼前发黑/, /天旋地转/],
    replies: ['先坐稳，别硬站着。我想确认一下，这样更容易判断当下行动是否安全。'],
  },
  {
    tag: 'medicationMissed',
    patterns: [/(?:忘(?:记|了)?|没|漏)(?:了)?(?:吃|服|用).{0,3}药/, /药忘/, /忘了.{0,3}药/],
    replies: ['先别自行加量补吃，按原来的医生方案处理。'],
  },
  {
    tag: 'bpHigh',
    patterns: [
      /血压(有)?(高|偏高)/,
      /血压\s*(?:\d{2,3}|[零〇一二两三四五六七八九十百]+)(?:\s*[/／,，比\-至~]\s*(?:\d{2,3}|[零〇一二两三四五六七八九十百]+))?/,
      /高压(?:\d{2,3}|[零〇一二两三四五六七八九十百]+)/,
      /低压(?:\d{2,3}|[零〇一二两三四五六七八九十百]+)\s*高压(?:\d{2,3}|[零〇一二两三四五六七八九十百]+)/,
      /高压(?:\d{2,3}|[零〇一二两三四五六七八九十百]+)\s*低压(?:\d{2,3}|[零〇一二两三四五六七八九十百]+)/,
      /收缩压(?:\d{2,3}|[零〇一二两三四五六七八九十百]+)\s*舒张压(?:\d{2,3}|[零〇一二两三四五六七八九十百]+)/,
      /舒张压(?:\d{2,3}|[零〇一二两三四五六七八九十百]+)\s*收缩压(?:\d{2,3}|[零〇一二两三四五六七八九十百]+)/,
    ],
    replies: ['先坐下来安静一会儿，再按设备说明复测。单次读数不要自己下结论。'],
  },
  {
    tag: 'chestPain',
    patterns: [/胸(口)?痛/, /胸疼/, /胸(口)?.{0,5}(痛|疼)/, /胸口.{0,4}(压迫|压着|紧)/, /心口痛/],
    replies: ['先停止活动并保持安全姿势。如果胸痛明显或持续，尤其伴喘、冷汗、头晕，应立即寻求急救。'],
  },
  {
    tag: 'neuroChange',
    // P0 收紧：这是急救级标签，误报的代价是老人恐慌 + 家属狼来了。
    // 旧双向模式 (腿)(突然)?没劲 让慢性活动耐量下降（"走路腿没劲、上三楼要歇两次"）
    // 命中卒中规则并触发急救回复（评审现场实测误报）。单侧无力、口齿、嘴角、
    // 视力症状本身就是急症指征，保持无条件命中；双侧肢体症状必须携带急性时间词。
    patterns: [
      /说话(不清楚|含糊|不利索)/,
      /(嘴角|嘴).{0,3}(歪|偏)/,
      /(一侧|半边|一边).{0,4}(无力|没劲|发麻|麻木)/,
      /(?:突然|忽然|猛然|一下子|刚刚|刚才)[^。？\n]{0,8}(?:手脚|两条?腿|两只?手|胳膊|腿|半边身子)[^。？\n]{0,4}(?:无力|没劲|发麻|麻木)/,
      /(?:手脚|两条?腿|两只?手|胳膊|腿|半边身子)[^。？\n]{0,2}(?:突然|忽然|猛然|一下子)[^。？\n]{0,2}(?:无力|没劲|发麻|麻木)/,
      /突然看不清/,
    ],
    replies: ['先别走动，立即联系家里人并寻求急救。这类突然出现的情况不适合在家继续观察。'],
  },
  {
    tag: 'pain',
    patterns: [/(疼|痛)/, /不舒服/],
    replies: ['哪里不舒服可以慢慢告诉我：位置、持续多久，以及什么时候最明显。'],
  },
  {
    tag: 'moodLow',
    patterns: [/(心|心情)(烦|闷|不好)/, /没意思/, /孤独/, /想(孩子|家里人)/],
    replies: ['我在这儿，您慢慢说。'],
  },
  {
    tag: 'fall',
    // 让步句式"X是没X"（摔是没摔）是构式而非词表枚举，作为兜底补收；
    // 否定语义由 statusFromText/结构化否定判定，不会误记成摔倒发生。
    patterns: [/(摔|跌)\s*是\s*没(?:有)?\s*(?:摔|跌)/, /(摔|跌)(倒|了一跤|了一下|过|了)/, /摔倒/],
    replies: ['先别急着起身，先确认有没有明显疼痛、出血、意识异常或站不起来。'],
  },
  {
    tag: 'spo2Low',
    patterns: [
      /血氧(?:也)?(?:掉到|偏低|不够|低(?:了|一点)?)/,
      /(?:血氧|spo2|SPO2|SpO2|氧饱和度).{0,8}?(?:1[01]\d|[789]\d|[零〇一二两三四五六七八九]+)/,
    ],
    replies: ['血氧偏低，先坐下来保持手部温暖，按设备说明复测一次；如果还低或伴喘、嘴唇发紫，立即告诉我或找家人帮忙。'],
  },
  {
    tag: 'hrHigh',
    patterns: [
      /(?:心跳|心率|脉搏|静息心率)[^。\n]{0,12}(?:快|高|偏快|太快)/,
      /(?:心跳|心率)[^。\n]{0,8}?(?:1[2-9]\d|2\d\d|一百[二三四五六七八九零]|二百)/,
    ],
    replies: ['安静时心跳偏快，先停下来休息，按设备说明复测；如果还快或伴胸闷、头晕，告诉我或找家人。'],
  },
  {
    tag: 'hrLow',
    patterns: [/(?:心跳|心率|脉搏|静息心率)[^。\n]{0,12}(?:慢|低|偏慢|太慢)/],
    replies: ['安静时心跳偏慢，先坐下来不要独自活动，按设备说明复测；如果还慢或伴头晕、黑朦，立即告诉我或找家人。'],
  },
  {
    tag: 'glucoseHigh',
    patterns: [
      /(?:血糖|空腹血糖|餐后血糖)[^。\n]{0,12}(?:高|偏高|太高|飙|上去)/,
      /(?:血糖|空腹血糖|餐后血糖).{0,8}?(?:1[5-9]|[2-3]\d|十[二三四五六七八九零]|二十|三十)/,
    ],
    replies: ['血糖偏高，先复测一次确认测量时间和是否空腹；持续偏高或伴口渴、乏力，告诉我或联系医生。'],
  },
  {
    tag: 'glucoseLow',
    patterns: [
      /(?:血糖|空腹血糖)[^。\n]{0,12}(?:低|偏低|低血糖|掉到|太低)/,
      /(?:血糖|空腹血糖).{0,8}?(?:[1-3]\.\d|[1-3]\b)/,
    ],
    replies: ['血糖偏低，按医生方案补糖，15 分钟内复测；如果出现意识变化、站不稳或出冷汗，立即告诉我或找家人。'],
  },
];

export interface ParsedInput {
  tags: SymptomTag[];
  matchedTexts: string[];
}

/**
 * 慢性/劳损语境且无急性时间词（P0-1 配套）。
 * "走路腿没劲、上楼要歇"是活动耐量问题，不是卒中；LLM 补标的 neuroChange
 * 在这类子句上不可信——急救级标签的补标必须有急性证据兜底。规则层用
 * 急性时间词门控（见 INTENT_RULES.neuroChange），本函数给 LLM 合并层做同一件事。
 */
export function isChronicWithoutAcuteOnset(clause: string): boolean {
  const chronic = /(?:最近|这两天|这几天|这阵子|这段时间|走路|上楼|爬楼|活动)/.test(clause);
  const acute = /(?:突然|忽然|猛然|一下子|刚刚|刚才)/.test(clause);
  return chronic && !acute;
}

export function parseElderInput(text: string): ParsedInput {
  const tags: SymptomTag[] = [];
  const matchedTexts: string[] = [];
  for (const rule of INTENT_RULES) {
    for (const pattern of rule.patterns) {
      const match = text.match(pattern);
      if (match) {
        tags.push(rule.tag);
        matchedTexts.push(match[0]);
        break;
      }
    }
  }
  return { tags: tags.filter((tag, index) => tags.indexOf(tag) === index), matchedTexts };
}

export interface SymptomSpan {
  tag: SymptomTag;
  start: number;
  end: number;
  text: string;
}

/** 与 parseElderInput 相同的规则集，但保留每个命中的位置，供否定辖域等结构分析使用。 */
export function matchSymptomSpans(text: string): SymptomSpan[] {
  const spans: SymptomSpan[] = [];
  for (const rule of INTENT_RULES) {
    for (const pattern of rule.patterns) {
      const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
      let match: RegExpExecArray | null;
      while ((match = global.exec(text)) !== null) {
        if (match[0].length === 0) {
          global.lastIndex += 1;
          continue;
        }
        spans.push({ tag: rule.tag, start: match.index, end: match.index + match[0].length, text: match[0] });
      }
    }
  }
  return spans;
}

function buildBloodPressureReply(text: string): string | undefined {
  const values = extractHealthValues(text).filter((value) => value.unit === 'mmHg');
  const systolic = values.find((value) => value.metric === 'systolic')?.value;
  const diastolic = values.find((value) => value.metric === 'diastolic')?.value;
  if (systolic !== undefined && diastolic !== undefined) {
    return `您刚才说的血压是 ${systolic}/${diastolic} mmHg。先坐下来安静一会儿，再按设备说明复测。单次读数不要自己下结论。`;
  }
  if (systolic !== undefined) {
    return `您刚才说的高压是 ${systolic} mmHg。先坐下来安静一会儿，再按设备说明复测。单次读数不要自己下结论。`;
  }
  return undefined;
}

function buildValueAwareMetricReply(text: string, metric: 'spo2' | 'restingHr' | 'bloodGlucose'): string | undefined {
  const value = extractHealthValues(text).find((v) => v.metric === metric)?.value;
  if (value === undefined) return undefined;
  if (metric === 'spo2') {
    return `\u60a8\u521a\u624d\u8bf4\u7684\u8840\u6c27\u662f ${value} %\u3002\u5148\u5750\u7a33\u3001\u4fdd\u6301\u624b\u90e8\u6e29\u6696\uff0c\u6309\u8bbe\u5907\u8bf4\u660e\u590d\u6d4b\u4e00\u6b21\uff1b\u5982\u679c\u4ecd\u4f4e\u6216\u4f34\u5634\u5507\u53d1\u7d2b\u3001\u8bd5\u4e0d\u5230\u547c\u5438\uff0c\u7acb\u5373\u544a\u8bc9\u6211\u4eec\u6216\u627e\u5bb6\u4eba\u3002`;
  }
  if (metric === 'restingHr') {
    return `\u60a8\u521a\u624d\u8bf4\u7684\u5fc3\u7387\u662f ${value} \u6b21/\u5206\u949f\u3002\u5148\u505c\u4e0b\u4f11\u606f\uff0c\u6309\u8bbe\u5907\u8bf4\u660e\u590d\u6d4b\uff1b\u5982\u679c\u4ecd\u5f02\u5e38\u6216\u4f34\u4e0d\u8212\u670d\uff0c\u7acb\u5373\u544a\u8bc9\u6211\u4eec\u6216\u627e\u5bb6\u4eba\u3002`;
  }
  if (metric === 'bloodGlucose') {
    return `\u60a8\u521a\u624d\u8bf4\u7684\u8840\u7cd6\u662f ${value} mmol/L\u3002\u590d\u6d4b\u4e00\u6b21\u786e\u8ba4\u6d4b\u91cf\u65f6\u95f4\u548c\u662f\u5426\u7a7a\u8179\uff1b\u5982\u679c\u4ecd\u504f\u9ad8\u6216\u4f4e\u6216\u4f34\u4e0d\u8212\u670d\uff0c\u8bf7\u544a\u8bc9\u6211\u4eec\u6216\u8054\u7cfb\u533b\u751f\u3002`;
  }
  return undefined;
}

function buildRuleBasedReply(
  elderText: string,
  newTags: SymptomTag[],
  findings: Finding[],
  isNewFall: boolean,
  context?: AgentContext,
): string {
  if (newTags.includes('chestPain'))
    return (
      INTENT_RULES.find((rule) => rule.tag === 'chestPain')?.replies[0] ??
      '先停止活动并保持安全姿势，必要时立即寻求急救。'
    );
  if (newTags.includes('neuroChange'))
    return (
      INTENT_RULES.find((rule) => rule.tag === 'neuroChange')?.replies[0] ?? '先别走动，立即联系家里人并寻求急救。'
    );
  if (newTags.includes('fall')) {
    const reply = INTENT_RULES.find((rule) => rule.tag === 'fall')?.replies[0];
    if (reply) return reply;
  }
  if (newTags.includes('bpHigh')) {
    const bloodPressureReply = buildBloodPressureReply(elderText);
    if (bloodPressureReply) return bloodPressureReply;
  }
  if (newTags.includes('spo2Low')) {
    const r = buildValueAwareMetricReply(elderText, 'spo2');
    if (r) return r;
  }
  if (newTags.includes('hrHigh') || newTags.includes('hrLow')) {
    const r = buildValueAwareMetricReply(elderText, 'restingHr');
    if (r) return r;
  }
  if (newTags.includes('glucoseHigh') || newTags.includes('glucoseLow')) {
    const r = buildValueAwareMetricReply(elderText, 'bloodGlucose');
    if (r) return r;
  }

  if (newTags.length === 0) {
    const unresolved = context?.priorityFindings.find((finding) => finding.severity === 'urgent');
    return unresolved
      ? `我先回答您现在说的内容。还有一件之前需要继续确认的事情：${unresolved.title}。`
      : '我在听。身体有什么不舒服，或者最近走路、睡觉有变化，都可以直接告诉我。';
  }
  const parts: string[] = [];
  for (const tag of newTags.slice(0, 2)) {
    const rule = INTENT_RULES.find((item) => item.tag === tag);
    if (rule) parts.push(rule.replies[0]);
  }
  if (context) {
    const followUps = suggestFollowUpQuestions(newTags, context);
    if (followUps.length > 0) parts.push(followUps[0].question);
  }
  if (isNewFall && !parts.some((part) => part.includes('摔倒')))
    parts.push('我会把这次情况当作需要优先确认安全的事件处理。');
  if (findings.some((finding) => finding.severity === 'urgent') && isNewFall) parts.push('请先确认自己现在是否安全。');
  return parts.join('\n');
}

export interface LlmAdapter {
  complete(
    systemPrompt: string,
    userText: string,
    context?: AgentContext,
  ): Promise<{ text: string; tags: SymptomTag[] }>;
}
export const ruleBasedAdapter: LlmAdapter = {
  async complete(_systemPrompt, userText, context) {
    const parsed = parseElderInput(userText);
    return {
      text: buildRuleBasedReply(userText, parsed.tags, [], parsed.tags.includes('fall'), context),
      tags: parsed.tags,
    };
  },
};

interface ExternalAgentContext {
  today: string;
  windowDays: number;
  safetyLevel: Finding['severity'];
  personTwin: {
    asOf: string;
    activity: 'stable' | 'declining' | 'improving' | 'unknown';
    mobility: 'stable' | 'declining' | 'improving' | 'unknown';
    sleep: 'stable' | 'declining' | 'improving' | 'unknown';
    nightActivity: 'stable' | 'declining' | 'improving' | 'unknown';
    recentSymptoms: SymptomTag[];
    activeConcerns: string[];
    safetyRelevantChanges: string[];
    functionalProfile: AgentContext['personTwin']['functionalProfile'];
  };
  metrics: AgentContext['metrics'];
  observations: AgentContext['observations'];
  labs: AgentContext['labs'];
  priorityFindings: AgentContext['priorityFindings'];
  suggestedAction?: string;
}

/**
 * 对外上下文的隐私边界 = 逐条 visibility / familyEligible 标记（与 metrics/observations/labs 一致）。
 * Person Twin 用仅公开数据重算（context.personTwinPublic），不再整体置 unknown——
 * 否则外部 LLM 模式拿不到任何趋势信号，“有理由地追问”完全失效。
 */
export function sanitizeExternalContext(context: AgentContext): ExternalAgentContext {
  const publicFindings = context.priorityFindings.filter((finding) => finding.familyEligible !== false);
  const safetyRank: Record<Finding['severity'], number> = { urgent: 0, alert: 1, watch: 2, info: 3 };
  const publicSafety = publicFindings.reduce<Finding['severity']>(
    (highest, finding) => (safetyRank[finding.severity] < safetyRank[highest] ? finding.severity : highest),
    'info',
  );
  return {
    today: context.today,
    windowDays: context.windowDays,
    safetyLevel: publicSafety,
    personTwin: context.personTwinPublic,
    metrics: context.metrics.filter((metric) => metric.visibility !== 'private'),
    observations: context.observations.filter((observation) => observation.visibility !== 'private'),
    labs: context.labs.filter((lab) => lab.visibility !== 'private'),
    priorityFindings: publicFindings,
    suggestedAction: undefined,
  };
}

/** 同源路径或明确的 HTTPS / 本机开发地址；Agent 上下文不能被指向任意外部主机。 */
export function isAllowedAgentEndpoint(endpoint: string): boolean {
  if (endpoint.startsWith('/')) return true;
  try {
    const url = new URL(endpoint);
    if (url.protocol === 'https:') return true;
    return (
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.hostname === '[::1]' ||
        url.hostname === '::1')
    );
  } catch {
    return false;
  }
}

/** 同源 API 适配器。API key 应保留在服务端，不进入 Vite 客户端；慢响应超时后由规则引擎兜底。 */
export function createHttpLlmAdapter(endpoint: string, timeoutMs = 12000): LlmAdapter {
  if (!isAllowedAgentEndpoint(endpoint))
    throw new Error('LLM endpoint must be a same-origin path, HTTPS URL, or localhost during development.');
  return {
    async complete(systemPrompt, userText, context) {
      const privacyIntent = parsePrivacyIntent(userText);
      if (privacyIntent === 'private' || privacyIntent === 'no_record')
        throw new Error('Private and no-record inputs must stay on the local safety adapter.');
      const safeContext = context ? sanitizeExternalContext(context) : undefined;
      const safeUserText = userText.trim().slice(0, MAX_AGENT_INPUT_LENGTH);
      // 超时必须覆盖响应体读取，否则挂起的端点仍会让整个对话回合无限等待。
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ systemPrompt, userText: safeUserText, context: safeContext }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`LLM endpoint returned ${response.status}`);
        const payload = (await response.json()) as { text?: string; tags?: SymptomTag[] };
        return { text: payload.text ?? '', tags: payload.tags ?? parseElderInput(userText).tags };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

const SYSTEM_PROMPT =
  '你是老人家庭健康助手。只解释已发现的变化和日常状态，不做疾病诊断。安全等级与是否需要升级由规则引擎决定。回答要短、温和、易听懂；有理由才追问。不要补写用户没有说过的症状、诱因、趋势或人物。';
const UNSAFE_REPLY_PATTERNS = [
  /(^|[。！？\s,，;；:])(?:诊断为|确诊为|您得了|你得了)(?![。！？\s]{0,10}报告|结果)/,
  /(?:您?可能(?:患有|得了|是|存在|伴发|怀疑)|您?怀疑|估计是|看起来像|高度怀疑|不能排除|不排除|高度疑似|疑似|推断是|应该是|多半是|一般是|看起来是)/,
  /(?:您?可能(?:是|得了|患有)?|您?怀疑|估计是|看起来像|不能排除|不排除|疑似|多半是|应该是|推断是)\s*(?:[肺心脑胃肝肠肾肢脊]部?)?(?:心衰|心脏病|心肌梗死|房颤|心律失常|脑卒中|中风|脑梗|脑出血|肺炎|感染|糖尿病|高血压|冠心病|胃炎|胃溃疡|肝炎|肾炎|贫血|甲亢|甲减|老年痴呆|帕金森|抑郁症|焦虑症|肿瘤|癌症|白血病|癌|脑栓塞|脑肿瘤|肺癌|肝癌|胃癌|肠癌|肾癌|糖尿病肾|肾衰)/,
  /(?:就是|一定是|肯定是|一定得了|就是得了)\s*(?:[肺心脑胃肝肠肾肢脊]部?)?(?:心衰|心脏病|心肌梗死|房颤|心律失常|脑卒中|中风|脑梗|脑出血|肺炎|感染|糖尿病|高血压|冠心病|胃炎|胃溃疡|肝炎|肾炎|贫血|甲亢|甲减|老年痴呆|帕金森|抑郁症|焦虑症|肿瘤|癌症|白血病|癌|脑栓塞|脑肿瘤|肺癌|肝癌|胃癌|肠癌|肾癌|糖尿病肾|肾衰)/,
  /(^|[。！？\s,，;；:])(?:请|建议|应该|需要|可以|最好|务必|必须).{0,15}(?:自行|自己)?(?:加倍|加量|减量|停药|停用|换药|加药|换用|暂停|改用|改服|换一种)/,
  // 单独 「换一种药」 / 「停药试试」 / 「加量看看」
  /(?:换一种药|停药试试|加量看看|换试试看|不吃这个药|自己换药|减少用量|换别的药|换种药)/,
  /(?:^|[。！？\s,，;：:])(?:请|建议|应该|可以|最好)\s*(?:服用|吃|吃点)\s*(?:阿司匹林|波立维|立普妥|他汀|降压药|降糖药|胰岛素|止痛药|安眠药|抗生素|激素|中药|西药|药片|药丸)/,
  /(?:^|[。！？\s,，;：:|您])(?:需要|建议|应该|最好|建议您)\s*(?:做|去做|跑一趟|查|检查)(?:一?[下个])?\s*(?:血常规|心电图|心脏彩超|心肌酶|肺部\s?CT|头部\s?CT|头部核磁|核磁共振|血糖|糖化|糖耐量|血压|血脂|冠脉造影|动态心电图|24\s?小时心电图|尿常规|便常规)/,
];
const MAX_AGENT_REPLY_LENGTH = 500;
const MAX_AGENT_INPUT_LENGTH = 1000;
export function isSafeAgentReply(text: string): boolean {
  const normalized = text.trim();
  if (!normalized || normalized.length > MAX_AGENT_REPLY_LENGTH) return false;
  return !UNSAFE_REPLY_PATTERNS.some((pattern) => pattern.test(normalized));
}
export async function generateAgentReply(
  elderText: string,
  newTags: SymptomTag[],
  findings: Finding[],
  isNewFall: boolean,
  context?: AgentContext,
  adapter: LlmAdapter = ruleBasedAdapter,
): Promise<string> {
  const safetyFinding = context?.priorityFindings.find(
    (finding) => (finding.severity === 'urgent' || finding.severity === 'alert') && finding.familyEligible !== false,
  );
  const safetyGuard = safetyFinding
    ? `当前最高风险等级为 ${safetyFinding.severity}，不要自行提高或降低等级。`
    : '当前没有可供外部模型使用的更高等级安全信号。';
  const systemPrompt = `${SYSTEM_PROMPT}\n${safetyGuard}\n已识别标签：${newTags.join(', ') || '无'}。`;
  try {
    const completion = await adapter.complete(systemPrompt, elderText, context);
    if (isSafeAgentReply(completion.text)) return completion.text.trim();
    return buildRuleBasedReply(elderText, newTags, findings, isNewFall, context);
  } catch {
    return buildRuleBasedReply(elderText, newTags, findings, isNewFall, context);
  }
}
export const QUICK_INPUTS = [
  '最近腿有点没劲',
  '最近走路有点喘',
  '这两天睡不好',
  '我有点头晕',
  '药忘记吃了',
  '刚才摔了一跤',
];
export function msg(
  role: ChatMessage['role'],
  text: string,
  time: string,
  persisted = true,
  extra?: Partial<Pick<ChatMessage, 'safetyAction' | 'blocks'>>,
): ChatMessage {
  return { id: `${role}-${time}-${Math.random().toString(36).slice(2, 8)}`, role, text, time, persisted, ...extra };
}
export function tagLabel(tag: SymptomTag): string {
  return SYMPTOM_LABELS[tag];
}
