/** 对话 Agent：规则负责识别与安全边界，Adapter 负责最终措辞。 */
import type { ChatMessage, ElderProfile, Finding, SymptomTag } from '../types';
import type { AgentContext } from './context';
import { SYMPTOM_LABELS } from '../types';
import { suggestFollowUpQuestions } from './questions';
import { parsePrivacyIntent } from './privacy';

interface IntentRule {
  tag: SymptomTag;
  patterns: RegExp[];
  replies: string[];
}

const INTENT_RULES: IntentRule[] = [
  {
    tag: 'fatigue',
    patterns: [/很?累/, /乏/, /没(有)?劲/, /提不起(精神|劲)/, /体力(不|跟不)上/],
    replies: ['先歇一歇，别硬撑。您如果愿意，可以告诉我这种累是从什么时候开始的。'],
  },
  {
    tag: 'dyspnea',
    patterns: [/喘/, /气(短|不够|促)/, /憋气/, /胸闷/, /上(楼|台阶)(费劲|吃力|喘)/],
    replies: ['别着急，慢慢说。我先记下您现在说的感觉，可以再告诉我是静坐时还是活动时更明显。'],
  },
  {
    tag: 'poorSleep',
    patterns: [/睡不(好|着|踏实)/, /失眠/, /夜醒/, /起夜/, /半夜(醒|起来)/],
    replies: ['睡不好确实难受，我记下了。我想再确认一个情况。'],
  },
  {
    tag: 'edema',
    patterns: [/(脚|腿|脚踝|小腿).{0,4}肿/, /肿了/, /鞋(紧|挤脚)/, /袜子(印|勒)/],
    replies: ['我记下了。脚踝或腿部的肿胀如果持续或越来越明显，建议尽快和医生沟通。'],
  },
  {
    tag: 'dizziness',
    patterns: [/头晕/, /头昏/, /站不稳/, /眼前发黑/, /天旋地转/],
    replies: ['先坐稳，别硬站着。我想确认一下，这样更容易判断当下行动是否安全。'],
  },
  {
    tag: 'medicationMissed',
    patterns: [/(忘|没|漏)(了)?(吃|服|用).{0,3}药/, /药忘/, /忘了.{0,3}药/],
    replies: ['先别自行加量补吃，按原来的医生方案处理。'],
  },
  {
    tag: 'bpHigh',
    patterns: [/血压(有)?(高|偏高)/, /高压\d{3}/],
    replies: ['先坐下来安静一会儿，再按设备说明复测。单次读数不要自己下结论。'],
  },
  {
    tag: 'chestPain',
    patterns: [/胸(口)?痛/, /胸疼/, /胸(口)?.{0,5}(痛|疼)/, /胸口.{0,4}(压迫|压着|紧)/, /心口(痛|疼)/],
    replies: ['先停止活动并保持安全姿势。如果胸痛明显或持续，尤其伴喘、冷汗、头晕，应立即寻求急救。'],
  },
  {
    tag: 'neuroChange',
    patterns: [
      /说话(不清楚|含糊|不利索)/,
      /(嘴角|嘴).{0,3}(歪|偏)/,
      /(一侧|半边|一边).{0,4}(无力|没劲|发麻|麻木)/,
      /(手脚|胳膊|腿).{0,4}(突然)?(无力|没劲|发麻|麻木)/,
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
    patterns: [/(摔|跌)(倒|了一跤|了一下|过一次|过了|了)/, /摔倒/],
    replies: ['先别急着起身，先确认有没有明显疼痛、出血、意识异常或站不起来。'],
  },
];

export interface ParsedInput {
  tags: SymptomTag[];
  matchedTexts: string[];
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

function buildRuleBasedReply(
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
    return { text: buildRuleBasedReply(parsed.tags, [], parsed.tags.includes('fall'), context), tags: parsed.tags };
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

function sanitizeExternalContext(context: AgentContext): ExternalAgentContext {
  const publicFindings = context.priorityFindings.filter((finding) => finding.familyEligible !== false);
  const safetyRank: Record<Finding['severity'], number> = { urgent: 0, alert: 1, watch: 2, info: 3 };
  const publicSafety = publicFindings.reduce<Finding['severity']>(
    (highest, finding) => (safetyRank[finding.severity] < safetyRank[highest] ? finding.severity : highest),
    'info',
  );
  const publicSymptoms = context.observations
    .filter((observation) => observation.visibility !== 'private')
    .flatMap((observation) => observation.tags)
    .filter((tag, index, tags) => tags.indexOf(tag) === index);
  return {
    today: context.today,
    windowDays: context.windowDays,
    safetyLevel: publicSafety,
    personTwin: {
      asOf: context.personTwin.asOf,
      activity: 'unknown',
      mobility: 'unknown',
      sleep: 'unknown',
      nightActivity: 'unknown',
      recentSymptoms: publicSymptoms,
      activeConcerns: publicFindings.map((finding) => finding.title).slice(0, 4),
      safetyRelevantChanges: [],
      functionalProfile: { mobility: 'unknown', usesCane: false, nightVision: 'unknown', cognition: 'unknown' },
    },
    metrics: context.metrics.filter((metric) => metric.visibility !== 'private'),
    observations: context.observations.filter((observation) => observation.visibility !== 'private'),
    labs: context.labs.filter((lab) => lab.visibility !== 'private'),
    priorityFindings: publicFindings,
    suggestedAction: undefined,
  };
}

/** 同源 API 适配器。API key 应保留在服务端，不进入 Vite 客户端。 */
export function createHttpLlmAdapter(
  endpoint: string,
  history: ChatMessage[] = [],
  profile?: ElderProfile,
): LlmAdapter {
  if (!endpoint.startsWith('/') && !endpoint.startsWith('https://') && !endpoint.startsWith('http://localhost'))
    throw new Error('LLM endpoint must be a same-origin path, HTTPS URL, or localhost during development.');
  return {
    async complete(systemPrompt, userText, context) {
      const privacyIntent = parsePrivacyIntent(userText);
      if (privacyIntent === 'private' || privacyIntent === 'no_record')
        throw new Error('Private and no-record inputs must stay on the local safety adapter.');
      const safeContext = context ? sanitizeExternalContext(context) : undefined;
      const safeUserText = userText.trim().slice(0, MAX_AGENT_INPUT_LENGTH);
      let includeReply = false;
      const safeHistory = history
        .filter((message) => {
          if (message.role === 'elder')
            includeReply =
              message.persisted !== false && !['private', 'no_record'].includes(parsePrivacyIntent(message.text));
          return includeReply && message.persisted !== false;
        })
        .slice(-12)
        .map((message) => ({
          role: message.role === 'elder' ? 'user' : 'assistant',
          content: message.text.slice(0, 1000),
        }));
      const response = await fetch(endpoint, {
        method: 'POST',
        signal: AbortSignal.timeout(30000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt,
          userText: safeUserText,
          context: {
            ...safeContext,
            confirmedProfile: profile
              ? {
                  name: profile.name,
                  age: profile.age,
                  conditions: profile.conditions,
                  medications: profile.medications,
                  mobility: profile.mobility,
                  nightVision: profile.nightVision,
                  injuryHistory: profile.injuryHistory,
                  usualNightWakes: profile.usualNightWakes,
                }
              : undefined,
          },
          history: safeHistory,
        }),
      });
      if (!response.ok) throw new Error(`LLM endpoint returned ${response.status}`);
      const payload = (await response.json()) as { text?: string; tags?: SymptomTag[] };
      return { text: payload.text ?? '', tags: payload.tags ?? parseElderInput(userText).tags };
    },
  };
}

const SYSTEM_PROMPT =
  '你是老人家庭健康助手。只解释已发现的变化和日常状态，不做疾病诊断。安全等级与是否需要升级由规则引擎决定。回答要短、温和、易听懂；有理由才追问。用户可以聊家人、心情与日常，先回应当前话题，不强行转为健康问答；不要把想念家人或普通情绪推断为疾病。不要补写用户没有说过的症状、诱因、趋势或人物。你不能拨号、发送消息或实际联系任何人，绝不能声称已经或将替用户联系家属、医生或社区。';
const UNSAFE_REPLY_PATTERNS = [
  /(^|[。！？\s])(诊断为|确诊为|您可能患有|你可能患有|您得了|你得了)/,
  /(就是|一定是|肯定是)(心衰|心脏病|脑卒中|中风|肺炎|感染)/,
  /(^|[。！？\s])(请|建议|应该|需要|可以).{0,12}(自行)?(加倍|加量|减量|停药|换药|加药)/,
  /(我|这边).{0,10}(帮您|替您)?(打(个)?电话|联系|通知)(家里人|家人|家属|医生|社区)/,
  /我这就.{0,10}(联系|打电话|通知)/,
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
    return buildRuleBasedReply(newTags, findings, isNewFall, context);
  } catch {
    const reply = buildRuleBasedReply(newTags, findings, isNewFall, context);
    return adapter === ruleBasedAdapter ? reply : `智能对话暂时未连接，以下是基础模式回复。\n${reply}`;
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
export function msg(role: ChatMessage['role'], text: string, time: string, persisted = true): ChatMessage {
  return { id: `${role}-${time}-${Math.random().toString(36).slice(2, 8)}`, role, text, time, persisted };
}
export function tagLabel(tag: SymptomTag): string {
  return SYMPTOM_LABELS[tag];
}
