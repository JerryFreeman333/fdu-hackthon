import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../types';

interface ChatViewProps {
  chat: ChatMessage[];
  onSend: (text: string) => void | Promise<void>;
  quickInputs: string[];
}

type SpeechRecognitionResultEvent = Event & { results: { [index: number]: { [index: number]: { transcript: string } } } };
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
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

export default function ChatView({ chat, onSend, quickInputs }: ChatViewProps) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.length]);

  useEffect(() => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    setVoiceSupported(Boolean(Recognition));
    return () => recognitionRef.current?.stop();
  }, []);

  function send(t: string) {
    const trimmed = t.trim();
    if (!trimmed) return;
    void onSend(trimmed);
    setText('');
  }

  function toggleVoice() {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new Recognition();
    recognition.lang = 'zh-CN';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results as unknown as ArrayLike<{ [index: number]: { transcript: string } }>)
        .map((result) => result[0]?.transcript ?? '')
        .join('');
      if (transcript.trim()) send(transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  return (
    <div className="chat-view">
      <div className="chat-intro">
        <div className="agent-greeting">
          我是<b>阿安</b>，您的健康小助手。身体有什么不舒服、心里有什么话，都可以跟我说。
          我会把它们和您的手表、血压数据放在一起看，发现“和平时不一样”的地方，帮您盯着。
        </div>
      </div>

      <div className="chat-list">
        {chat.map((m) => (
          <div key={m.id} className={`chat-row ${m.role === 'elder' ? 'row-elder' : 'row-agent'}`}>
            {m.role === 'agent' && <div className="chat-avatar">安</div>}
            <div className="chat-bubble">
              {m.text.split('\n').map((line, i) => <p key={i}>{line}</p>)}
              <div className="chat-time">{m.time}</div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="chat-quick">
        {quickInputs.map((q) => (
          <button key={q} className="chip" onClick={() => send(q)}>{q}</button>
        ))}
      </div>

      <div className="chat-input-row">
        {voiceSupported && (
          <button className={`btn-secondary ${listening ? 'is-listening' : ''}`} onClick={toggleVoice} aria-label="语音输入">
            {listening ? '停止' : '🎙️ 说话'}
          </button>
        )}
        <input
          className="chat-input"
          placeholder="像平时聊天一样，说说今天怎么样……"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send(text)}
        />
        <button className="btn-primary" onClick={() => send(text)}>发送</button>
      </div>
    </div>
  );
}
