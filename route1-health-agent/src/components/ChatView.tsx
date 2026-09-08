import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../types';
import { startVoiceRecognition, voiceErrorMessage, type VoiceState } from '../voice';

interface ChatViewProps {
  chat: ChatMessage[];
  onSend: (text: string) => void | boolean | Promise<void | boolean>;
  quickInputs: string[];
  pending?: boolean;
  failedText?: string;
  onRetry?: () => void;
  showQuickInputs?: boolean;
}

export default function ChatView({
  chat,
  onSend,
  quickInputs,
  pending = false,
  failedText = '',
  onRetry,
  showQuickInputs = false,
}: ChatViewProps) {
  const [text, setText] = useState('');
  const finishAndSend = useRef(false);
  const [checkBeforeSend, setCheckBeforeSend] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>('ready');
  const [voiceHint, setVoiceHint] = useState('点一下开始说话，全部说完后再点“说完并发送”。');
  const activeVoice = ['starting', 'listening', 'processing'].includes(voiceState);
  const [speaking, setSpeaking] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [ttsSupported, setTtsSupported] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<ReturnType<typeof startVoiceRecognition> | null>(null);

  useEffect(() => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    setVoiceState(Recognition ? 'ready' : 'unsupported');
    if (!Recognition) setVoiceHint('当前浏览器不支持语音识别，请使用文字或系统听写。');
    setTtsSupported(typeof window !== 'undefined' && 'speechSynthesis' in window);
    return () => {
      recognitionRef.current?.cancel();
      utteranceRef.current = null;
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.length, pending, failedText]);

  useEffect(() => {
    if (activeVoice && inputRef.current) inputRef.current.scrollTop = inputRef.current.scrollHeight;
  }, [text, activeVoice]);

  async function send(t: string) {
    const trimmed = t.trim();
    if (!trimmed || activeVoice || pending || failedText) return;
    try {
      const accepted = await onSend(trimmed);
      if (accepted !== false) setText('');
    } catch {
      // Preserve the draft when the caller rejects a send.
    }
  }

  function toggleVoice() {
    if (pending || failedText) return;
    if (activeVoice) {
      finishAndSend.current = !checkBeforeSend;
      recognitionRef.current?.stop();
      return;
    }
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceState('unsupported');
      setVoiceHint('当前浏览器不支持语音识别，请使用文字或系统听写。');
      return;
    }
    finishAndSend.current = false;
    recognitionRef.current?.cancel();
    utteranceRef.current = null;
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    const draft = text.trim();
    try {
      recognitionRef.current = startVoiceRecognition(new Recognition(), {
        state: (state, hint) => {
          if (state === 'error') finishAndSend.current = false;
          setVoiceState(state);
          setVoiceHint(checkBeforeSend ? hint : hint.replace(/说完了/g, '说完并发送'));
        },
        transcript: (transcript) => setText([draft, transcript].filter(Boolean).join(' ')),
        complete: (transcript) => {
          setText([draft, transcript].filter(Boolean).join(' '));
          if (finishAndSend.current) {
            finishAndSend.current = false;
            setVoiceHint('正在发送；如失败，文字会保留。');
            void send([draft, transcript].filter(Boolean).join(' '));
          } else inputRef.current?.focus();
        },
      });
    } catch {
      setVoiceState('error');
      setVoiceHint(voiceErrorMessage('start-failed'));
    }
  }

  function speak(textToRead: string) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(textToRead.replace(/\n/g, '。'));
    utterance.lang = 'zh-CN';
    utterance.rate = 0.9;
    utteranceRef.current = utterance;
    utterance.onstart = () => {
      if (utteranceRef.current === utterance) setSpeaking(true);
    };
    utterance.onend = utterance.onerror = () => {
      if (utteranceRef.current === utterance) setSpeaking(false);
    };
    window.speechSynthesis.speak(utterance);
  }

  return (
    <div className="chat-view">
      <div className="chat-intro">
        <p className="muted">可以说话，也可以打字。这里记录您的日常状态，不作疾病诊断。</p>
      </div>
      <div className="chat-list" aria-label="对话记录">
        {chat.map((m) => (
          <div key={m.id} className={`chat-row ${m.role === 'elder' ? 'row-elder' : 'row-agent'}`}>
            {m.role === 'agent' && <div className="chat-avatar">安</div>}
            <div className="chat-bubble">
              {m.text.split('\n').map((line, i) => (
                <p key={i}>{line}</p>
              ))}
              <div className="chat-time">{m.time}</div>
              {m.role === 'agent' && ttsSupported && (
                <button
                  className="btn-secondary"
                  onClick={() => speak(m.text)}
                  disabled={activeVoice || pending || Boolean(failedText)}
                  aria-label="朗读这条回复"
                >
                  🔊 朗读
                </button>
              )}
            </div>
          </div>
        ))}
        {pending && (
          <div className="chat-row row-agent">
            <div className="chat-avatar">安</div>
            <div className="chat-bubble" role="status">
              正在回复，请稍候…
            </div>
          </div>
        )}
        {failedText && (
          <div className="chat-bubble" role="alert">
            <p>这次回复没有完成，您的消息仍保留在对话中。</p>
            <button className="btn-primary" disabled={pending} onClick={onRetry}>
              重试这条消息
            </button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <details className="chat-suggestions" open={showQuickInputs || undefined}>
        <summary>{showQuickInputs ? '也可以点一下回答' : '不知道怎么开始？试试这些话'}</summary>
        <div className="chat-quick">
          {quickInputs.map((q) => (
            <button
              key={q}
              className="chip"
              disabled={activeVoice || pending || Boolean(failedText)}
              onClick={() => send(q)}
            >
              {q}
            </button>
          ))}
        </div>
      </details>
      {speaking && (
        <button
          className="btn-secondary stop-speech"
          onClick={() => {
            utteranceRef.current = null;
            window.speechSynthesis.cancel();
            setSpeaking(false);
          }}
        >
          停止朗读
        </button>
      )}
      <div className="voice-feedback" role="status" aria-live="polite">
        {voiceHint}
      </div>
      {activeVoice && (
        <button
          className="btn-secondary"
          onClick={() => {
            finishAndSend.current = false;
            recognitionRef.current?.cancel();
            setVoiceState('ready');
            setVoiceHint('录音已取消，已有文字保留在输入框，不会自动发送。');
          }}
        >
          取消录音
        </button>
      )}

      <details>
        <summary>语音发送设置</summary>
        <label>
          <input
            type="checkbox"
            checked={checkBeforeSend}
            disabled={activeVoice || pending}
            onChange={(e) => setCheckBeforeSend(e.target.checked)}
          />
          说完后先检查文字，再手动发送
        </label>
        <p>默认由您点“说完并发送”结束，不会因停顿自动发送。涉及药名和数字时建议先检查。</p>
      </details>
      <div className="chat-input-row">
        <button
          className={`btn-primary voice-entry ${activeVoice ? 'is-listening' : ''}`}
          onClick={toggleVoice}
          aria-label={
            voiceState === 'unsupported'
              ? '网页语音输入不可用'
              : activeVoice
                ? checkBeforeSend
                  ? '说完了，检查文字'
                  : '说完并发送'
                : '开始语音输入'
          }
          disabled={pending || Boolean(failedText) || voiceState === 'unsupported' || voiceState === 'processing'}
          aria-pressed={activeVoice}
        >
          {voiceState === 'processing'
            ? '整理中…'
            : activeVoice
              ? checkBeforeSend
                ? '说完了，检查文字'
                : '说完并发送'
              : voiceState === 'unsupported'
                ? '语音不可用'
                : '🎙️ 开始说话'}
        </button>
        <textarea
          rows={4}
          aria-label="消息与实时语音转写"
          readOnly={activeVoice || pending || Boolean(failedText)}
          ref={inputRef}
          className="chat-input"
          placeholder="说话时，文字会显示在这里；也可以直接输入…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !activeVoice) {
              e.preventDefault();
              send(text);
            }
          }}
        />
        <button
          className="btn-primary"
          disabled={pending || Boolean(failedText) || activeVoice || !text.trim()}
          onClick={() => send(text)}
        >
          发送
        </button>
      </div>
      {text.trim() && !activeVoice && <div className="muted">请检查文字，尤其是药名和数字；可直接修改，再点发送。</div>}
    </div>
  );
}
