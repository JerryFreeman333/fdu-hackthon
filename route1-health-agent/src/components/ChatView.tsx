import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../types';

interface ChatViewProps {
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
  const [ttsSupported, setTtsSupported] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.length]);

  useEffect(() => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    setVoiceSupported(Boolean(Recognition));
    setTtsSupported(typeof window !== 'undefined' && 'speechSynthesis' in window);
    return () => {
      recognitionRef.current?.stop();
      window.speechSynthesis?.cancel();
    };
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
      const transcript = Array.from(
        { length: event.results.length },
        (_, index) => event.results[index]?.[0]?.transcript ?? '',
      ).join('');
      if (transcript.trim()) send(transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  function speak(textToRead: string) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(textToRead.replace(/\n/g, '。'));
    utterance.lang = 'zh-CN';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
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

      {!voiceSupported && <div className="muted voice-fallback">当前浏览器不支持语音输入，可以直接打字，或让家人帮忙操作。</div>}

      <div className="chat-input-row">
        {voiceSupported && (
          <button
            className={`btn-secondary ${listening ? 'is-listening' : ''}`}
            onClick={toggleVoice}
            aria-label="语音输入"
          >
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
        <button className="btn-primary" onClick={() => send(text)}>
          发送
        </button>
      </div>
    </div>
  );
}
