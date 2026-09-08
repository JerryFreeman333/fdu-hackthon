import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../types';

interface ChatViewProps {
  id?: string;
  chat: ChatMessage[];
  onSend: (text: string) => void | Promise<void>;
  quickInputs: string[];
}

type SpeechRecognitionResultEvent = Event & {
  results: {
    length: number;
    [index: number]: { [index: number]: { transcript: string } };
  };
};
type SpeechRecognitionErrorEvent = Event & { error?: string };
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

type VoiceState = 'ready' | 'unsupported' | 'listening' | 'permission' | 'error';

function voiceMessage(state: VoiceState): string {
  switch (state) {
    case 'unsupported':
      return '当前浏览器没有提供网页语音输入，可以使用键盘上的麦克风听写，再检查文字后发送。';
    case 'permission':
      return '麦克风权限未通过。请在浏览器权限设置中允许麦克风；也可以直接使用键盘听写。';
    case 'error':
      return '网页语音输入没有成功启动。可以检查麦克风权限、网络和浏览器支持情况，或改用键盘听写。';
    default:
      return '';
  }
}

export default function ChatView({ id, chat, onSend, quickInputs }: ChatViewProps) {
  const [text, setText] = useState('');
  const [voiceState, setVoiceState] = useState<VoiceState>('ready');
  const [ttsSupported, setTtsSupported] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    setVoiceState(Recognition ? 'ready' : 'unsupported');
    setTtsSupported(typeof window !== 'undefined' && 'speechSynthesis' in window);
    return () => {
      recognitionRef.current?.stop();
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.length]);

  function send(t: string) {
    const trimmed = t.trim();
    if (!trimmed) return;
    void onSend(trimmed);
    setText('');
  }

  function toggleVoice() {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceState('unsupported');
      return;
    }
    if (voiceState === 'listening') {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new Recognition();
    recognition.lang = 'zh-CN';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(
        { length: event.results.length },
        (_, index) => event.results[index]?.[0]?.transcript ?? '',
      ).join('');
      if (transcript.trim()) {
        setText(transcript.trim());
        inputRef.current?.focus();
        setVoiceState('ready');
      }
    };
    recognition.onend = () => {
      setVoiceState((current) => (current === 'listening' ? 'ready' : current));
    };
    recognition.onerror = (event) => {
      const error = event.error ?? 'unknown';
      setVoiceState(error === 'not-allowed' || error === 'service-not-allowed' ? 'permission' : 'error');
    };
    recognitionRef.current = recognition;
    setVoiceState('listening');
    try {
      recognition.start();
    } catch {
      setVoiceState('error');
    }
  }

  function speak(textToRead: string) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(textToRead.replace(/\n/g, '。'));
    utterance.lang = 'zh-CN';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  }

  const voiceHint = voiceMessage(voiceState);

  return (
    <div id={id} className="chat-view">
      <div className="chat-intro">
        <div className="agent-greeting">
          我是<b>阿安</b>，您的健康小助手。身体有什么不舒服、心里有什么话，都可以跟我说。
          目前页面里的手表、血压等设备数据是演示接口，真实硬件尚未接入；我不会把演示数据当成您当前真实测量。
        </div>
      </div>

      <div className="chat-list">
        {chat.map((m) => (
          <div key={m.id} className={`chat-row ${m.role === 'elder' ? 'row-elder' : 'row-agent'}`}>
            {m.role === 'agent' && <div className="chat-avatar">安</div>}
            <div className="chat-bubble">
              {m.text.split('\n').map((line, i) => (
                <p key={i}>{line}</p>
              ))}
              <div className="chat-time">{m.time}</div>
              {m.role === 'agent' && ttsSupported && (
                <button className="btn-secondary" onClick={() => speak(m.text)} aria-label="朗读这条回复">
                  🔊 朗读
                </button>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="chat-quick">
        {quickInputs.map((q) => (
          <button key={q} className="chip" onClick={() => send(q)}>
            {q}
          </button>
        ))}
      </div>

      {voiceState !== 'listening' && voiceHint && <div className="muted voice-fallback">{voiceHint}</div>}

      <div className="chat-input-row">
        <button
          className={`btn-secondary ${voiceState === 'listening' ? 'is-listening' : ''}`}
          onClick={toggleVoice}
          aria-label={voiceState === 'unsupported' ? '网页语音输入不可用' : '语音输入'}
          disabled={voiceState === 'unsupported'}
        >
          {voiceState === 'listening' ? '停止录音' : voiceState === 'unsupported' ? '🎙️ 语音不可用' : '🎙️ 说话'}
        </button>
        <input
          ref={inputRef}
          className="chat-input"
          placeholder="像平时聊天一样，说说今天怎么样……"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send(text)}
        />
        <button className="btn-primary" onClick={() => send(text)}>
          发送
        </button>
      </div>
      {text.trim() && voiceState !== 'listening' && (
        <div className="muted">语音转写已放进输入框，请确认文字无误后再发送。</div>
      )}
    </div>
  );
}
