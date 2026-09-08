import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ElderProfile } from '../types';
import {
  answerProfileQuestion,
  nextProfileQuestion,
  profileAnswer,
  profileQuestions,
} from '../engine/profileInterview';
import { parseProfileUnderstanding } from '../engine/profileUnderstanding';
import { parsePrivacyIntent } from '../engine/privacy';
import ChatView from './ChatView';

const labels = ['称呼', '年龄', '已确诊疾病', '跌倒、骨折与恢复', '行动情况', '夜间视力', '起夜次数', '日常用药'];
export function ProfileSummary({ profile }: { profile: ElderProfile }) {
  return (
    <dl className="profile-summary">
      {profileQuestions.map((q, index) => (
        <div key={q.key}>
          <dt>{labels[index]}</dt>
          <dd>{profileAnswer(profile, index) || '还没聊到这里'}</dd>
        </div>
      ))}
    </dl>
  );
}
function message(role: ChatMessage['role'], text: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    text,
    time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
  };
}
export default function ProfileSetup({
  initial,
  onSave,
  onProgress,
  onCancel,
  onBusyChange,
}: {
  initial: ElderProfile;
  onSave: (profile: ElderProfile) => void;
  onProgress: (profile: ElderProfile) => void;
  onCancel?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [step, setStep] = useState(() => nextProfileQuestion(initial));
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [error, setError] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [pending, setPending] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const busy = useRef(false);
  const request = useRef<AbortController | null>(null);
  const endpoint = import.meta.env.VITE_AGENT_LLM_ENDPOINT || '/api/agent';
  const reviewing = step === profileQuestions.length;
  const prompt =
    followUp ||
    (reviewing
      ? '基本情况已经记好了。说错的地方可以直接告诉我修改，或者点“开始日常聊天”。'
      : profileQuestions[step].text);
  useEffect(() => {
    const abort = new AbortController();
    void fetch(endpoint + '/status', { signal: abort.signal })
      .then(async (response) => {
        const state = await response.json();
        setConfigured(response.ok && state.configured === true);
      })
      .catch(() => {
        if (!abort.signal.aborted) setConfigured(false);
      });
    return () => {
      abort.abort();
      request.current?.abort();
      onBusyChange?.(false);
    };
  }, [endpoint, onBusyChange]);

  function finish() {
    try {
      onSave({ ...draft, profileInterviewComplete: true, profileUpdatedAt: new Date().toISOString() });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function send(text: string): Promise<boolean> {
    if (busy.current) return false;
    setError('');
    if (reviewing && /^(开始日常聊天|确认保存|确认)[。！!]*$/.test(text.trim())) {
      finish();
      return true;
    }
    if (['private', 'no_record'].includes(parsePrivacyIntent(text))) {
      setChat((current) => [
        ...current,
        message('agent', '这段话不会发送给 DeepSeek，也没有保存到档案。您可以改用下面的选项，或先开始日常聊天。'),
      ]);
      return false;
    }
    if (text.length > 1000) {
      setError('请分成短一点的几句话，每次不超过1000字。');
      return false;
    }
    busy.current = true;
    setPending(true);
    onBusyChange?.(true);
    setChat((current) => [...current, message('agent', prompt), message('elder', text)]);
    try {
      const base = draft;
      const choices: readonly string[] = reviewing ? [] : profileQuestions[step].choices;
      const localChoice = !reviewing && !followUp && [...choices, '不清楚', '不想回答'].includes(text);
      let understood: { profile: ElderProfile; fields: number[]; reply: string };
      if (localChoice) {
        understood = { profile: answerProfileQuestion(base, step, text), fields: [step], reply: '' };
      } else {
        const abort = new AbortController();
        request.current = abort;
        const timer = setTimeout(() => abort.abort(), 30000);
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            signal: abort.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'profile', userText: text, profile: base, question: prompt }),
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || '智能理解暂时不可用，请稍后重试。');
          understood = parseProfileUnderstanding(payload, base, text);
          setConfigured(true);
        } finally {
          clearTimeout(timer);
        }
      }
      if (understood.fields.length) {
        onProgress(understood.profile);
        setDraft(understood.profile);
        setStep(nextProfileQuestion(understood.profile));
        setFollowUp('');
        setChat((current) => [
          ...current,
          message(
            'agent',
            '已记录：' +
              understood.fields
                .map((index) => labels[index] + '，' + profileAnswer(understood.profile, index))
                .join('；') +
              '。如果不对，直接告诉我改成什么。',
          ),
        ]);
      } else {
        setFollowUp(understood.reply);
      }
      return true;
    } catch (e) {
      setError(e instanceof Error && e.name !== 'AbortError' ? e.message : '智能理解连接超时，请重试。');
      return false;
    } finally {
      busy.current = false;
      setPending(false);
      onBusyChange?.(false);
    }
  }
  const quickInputs = reviewing
    ? ['开始日常聊天']
    : [...new Set([...profileQuestions[step].choices, '不清楚', '不想回答'])];
  return (
    <section className="card setup-card">
      <div className="eyebrow">阿安 · 先认识您</div>
      <h1>我们慢慢聊</h1>
      <p className="muted">可以一次说几件事，也可以随时纠正或以后再补。回答会自动记录，说错了直接告诉我修改。</p>
      <p className="muted" role="status">
        {configured === null
          ? '正在检查智能对话连接…'
          : configured
            ? '智能对话已连接，可以直接说出您的回答。'
            : '智能对话未配置或服务不可用 · 仍可点选回答，或稍后补充。'}
      </p>
      <p className="muted">您的回答和基本资料会交给外部智能对话服务处理，记录保存在当前浏览器。</p>
      <ChatView
        chat={pending ? chat : [...chat, { id: 'current-question', role: 'agent', text: prompt, time: '' }]}
        onSend={send}
        quickInputs={quickInputs}
        pending={pending}
        showQuickInputs
      />
      {error && (
        <p className="form-error" role="alert">
          {error} 这条回答尚未保存，输入框中的文字已保留。
        </p>
      )}
      <details open={reviewing} className="card">
        <summary>已经保存的基本情况</summary>
        <ProfileSummary profile={draft} />
        <div className="form-actions">
          {profileQuestions.map((q, index) => (
            <button
              key={q.key}
              className="btn-secondary"
              disabled={pending}
              onClick={() => {
                setStep(index);
                setError('');
                setFollowUp('');
              }}
            >
              修改{labels[index]}
            </button>
          ))}
        </div>
      </details>
      <button className="btn-secondary" disabled={pending} onClick={finish}>
        {reviewing ? '开始日常聊天' : '其余以后再补，开始聊天'}
      </button>
      {onCancel && (
        <button className="text-button" disabled={pending} onClick={onCancel}>
          返回我的
        </button>
      )}
    </section>
  );
}
