/**
 * 对话 Agent —— 从老人随口说的话里识别"值得记下来的变化"。
 * 当前为规则实现（可离线演示），LlmAdapter 留出后续接大模型的位置。
 */
import type { ChatMessage, Finding, SymptomTag } from '../types';
import { SYMPTOM_LABELS } from '../types';

interface IntentRule {
  tag: SymptomTag;
  patterns: RegExp[];
  /** 共情回应 + 追问 */
  replies: string[];
}

const INTENT_RULES: IntentRule[] = [
  {
    tag: 'fatigue',
    patterns: [/很?累/, /乏/, /没(有)?劲/, /提不起(精神|劲)/, /体力(不|跟不)上/],
    replies: [
      '累的时候先歇着，别硬撑。这种累是一直都有，还是活动以后才明显？',
      '听到了。最近是比平时容易累吗？大概这种情况持续几天了？',
    ],
  },
  {
    tag: 'dyspnea',
    patterns: [/喘/, /气(短|不够|促)/, /憋气/, /胸闷/, /上(楼|台阶)(费劲|吃力|喘)/],
    replies: [
      '走路、上台阶的时候喘，这个我要记下来帮您盯着。是走多远就开始喘？休息一会儿能缓过来吗？',
      '好，我记下了。喘的时候有没有胸口发闷？如果越来越厉害，咱们就要早点找医生看看。',
    ],
  },
  {
    tag: 'poorSleep',
    patterns: [/睡不(好|着|踏实)/, /失眠/, /夜醒/, /起夜/, /半夜(醒|起来)/],
    replies: [
      '睡不好挺熬人的。是一躺下睡不着，还是半夜老醒？白天可以少睡会儿，晚上睡前少喝水。',
      '我记下了。起夜多的话，地上留个夜灯，慢慢走，当心摔倒。',
    ],
  },
  {
    tag: 'edema',
    patterns: [/(脚|腿|脚踝|小腿).{0,4}肿/, /肿了/, /鞋(紧|挤脚)/, /袜子(印|勒)/],
    replies: [
      '脚肿这个事咱们要认真对待。用手按一按小腿或脚踝，有没有一个坑半天弹不起来？如果肿得厉害或者越来越肿，要尽快看医生。',
      '我记下了。今天先少盐清淡一点，把脚垫高休息。要是一直消不下去，咱们联系社区医生看看。',
    ],
  },
  {
    tag: 'dizziness',
    patterns: [/头晕/, /头昏/, /站不稳/, /眼前发黑/, /天旋地转/],
    replies: [
      '头晕的时候先坐下或扶稳，别硬站着。是站起来的时候晕，还是一直都晕？量个血压给我看看。',
      '记下了。这几天起床、起身都慢一点，头晕频繁的话要告诉家里人。',
    ],
  },
  {
    tag: 'medicationMissed',
    patterns: [/(忘|没|漏)(了)?(吃|服|用).{0,3}药/, /药忘/, /忘了.{0,3}药/],
    replies: [
      '偶尔忘一次别太紧张，想起来了按平常的量吃就行，千万不要一次补双份。要不要我把吃药提醒开响一点？',
      '好，我帮您记着。以后到点我会多提醒您一遍。',
    ],
  },
  {
    tag: 'bpHigh',
    patterns: [/血压(有)?(高|偏高)/, /高压\d{3}/, /一百[四五六七八九]*/],
    replies: [
      '血压高的时候先坐下歇 5 分钟再量一次。如果连续几天都偏高，或者伴随头晕、胸闷，咱们要联系医生调一调。',
      '记下了。今天先少盐，按时吃药，我盯着数据。',
    ],
  },
  {
    tag: 'pain',
    patterns: [/(疼|痛)/, /不舒服/],
    replies: [
      '哪里不舒服跟我说具体点：是哪个位置？疼多久了？一直疼还是一阵阵的？',
      '记下了。要是一直疼或者越来越疼，别忍着，咱们尽早找医生。',
    ],
  },
  {
    tag: 'moodLow',
    patterns: [/(心|心情)(烦|闷|不好)/, /没意思/, /孤独/, /想(孩子|家里人)/],
    replies: [
      '心里闷得慌的时候，跟我说说也行。要不咱们给家里打个电话？或者听听您喜欢的戏？',
      '我陪您聊。这几天让家里人常来看看您，好吗？',
    ],
  },
  {
    tag: 'fall',
    patterns: [/(摔|跌)(倒|了一跤|了一下)/, /摔倒/],
    replies: [
      '先别急，慢慢活动一下手脚，看看有没有哪里疼。如果疼得厉害或者站不起来，马上给家里人打电话！我这就通知他们。',
    ],
  },
];

export interface ParsedInput {
  tags: SymptomTag[];
  matchedTexts: string[];
}

/** 从一句话里识别症状标签（同一句话可能命中多个） */
export function parseElderInput(text: string): ParsedInput {
  const tags: SymptomTag[] = [];
  const matchedTexts: string[] = [];
  for (const rule of INTENT_RULES) {
    for (const p of rule.patterns) {
      const m = text.match(p);
      if (m) {
        tags.push(rule.tag);
        matchedTexts.push(m[0]);
        break;
      }
    }
  }
  return { tags, matchedTexts };
}

function empathyLead(tag: SymptomTag): string {
  const lead: Partial<Record<SymptomTag, string>> = {
    fatigue: '辛苦了，',
    dyspnea: '别着急，慢慢说，',
    poorSleep: '睡不好确实难受，',
    edema: '别担心，咱们一步一步看，',
    dizziness: '先坐稳，',
    medicationMissed: '没事的，',
    bpHigh: '别慌，',
    pain: '哎哟，',
    moodLow: '我在这儿呢，',
    fall: '先稳住，',
  };
  return lead[tag] ?? '';
}

/**
 * 生成 Agent 的回复。
 * @param newTags   这句话识别出的标签
 * @param findings  当前全量检测结果（用于主动告知）
 * @param isNewFall 这条消息是否包含跌倒
 */
export function generateAgentReply(
  elderText: string,
  newTags: SymptomTag[],
  findings: Finding[],
  isNewFall: boolean,
): string {
  if (newTags.length === 0) {
    return '我在听。身体上有任何不舒服，或者吃了什么、走了多少路，都可以跟我念叨念叨。';
  }

  const parts: string[] = [];
  for (const tag of newTags.slice(0, 2)) {
    const rule = INTENT_RULES.find((r) => r.tag === tag);
    if (rule) {
      parts.push(empathyLead(tag) + rule.replies[parts.length % rule.replies.length]);
    }
  }

  // 主诉与数据对上时，温和地主动说出来（不做诊断）
  const fusion = findings.find((f) => f.id.includes('fusion'));
  if (fusion && (newTags.includes('fatigue') || newTags.includes('dyspnea'))) {
    parts.push(
      `另外我留意了一下您的数据：${fusion.evidence[0]}。我把这些记到您的健康档案里了，也会在需要的时候提醒家里人，您别有负担。`,
    );
  }
  if (isNewFall) {
    parts.push('我已经把跌倒的事通知您家里人了，请保持电话畅通。');
  }

  void elderText;
  return parts.join('\n');
}

/** 快捷输入（演示用） */
export const QUICK_INPUTS = ['今天很累', '最近走路有点喘', '这两天睡不好', '脚有点肿', '药忘记吃了', '刚才摔了一跤'];

/** 生成一条聊天消息 */
export function msg(role: ChatMessage['role'], text: string, time: string): ChatMessage {
  return { id: `${role}-${time}-${Math.random().toString(36).slice(2, 8)}`, role, text, time };
}

/** 后续接大模型的适配器接口：替换实现即可，界面与引擎不用动 */
export interface LlmAdapter {
  complete(systemPrompt: string, userText: string): Promise<{ text: string; tags: SymptomTag[] }>;
}

export const ruleBasedAdapter: LlmAdapter = {
  async complete(_systemPrompt: string, userText: string) {
    const parsed = parseElderInput(userText);
    return { text: '', tags: parsed.tags };
  },
};

/** 把标签翻译成人话（界面显示用） */
export function tagLabel(tag: SymptomTag): string {
  return SYMPTOM_LABELS[tag];
}
