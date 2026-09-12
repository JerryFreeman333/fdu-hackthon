import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ElderProfile } from '../types';
import SafetyActions from './SafetyActions';
import VoiceListeningDialog from './VoiceListeningDialog';
import type { DataMode } from '../store/profileStore';

interface ChatViewProps {
  id?: string;
  chat: ChatMessage[];
  onSend: (text: string) => void | Promise<void>;
  quickInputs: string[];
  profile: ElderProfile;
  /** 决定开场说明：demo 提示设备数据是模拟的；personal 说明数据只在本机。 */
  deviceNote?: DataMode;
}

type SpeechRecognitionResultEvent = Event & {
  results: {
    length: number;
    [index: number]: { [index: number]: { transcript: string } };
  };
};
type SpeechRecognitionErrorEvent = Event & { error?: string };
type SpeechRecognitionLike = {
  onstart?: (() => void) | null;
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

export default function ChatView({ id, chat, onSend, quickInputs, profile, deviceNote = 'demo' }: ChatViewProps) {
  const [text, setText] = useState('');
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);
  const chatListRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTtsSupported(typeof window !== 'undefined' && 'speechSynthesis' in window);
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    const list = chatListRef.current;
    if (!list) return;
    list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  }, [chat.length]);

  function send(t: string) {
    const trimmed = t.trim();
    if (!trimmed) return;
    void onSend(trimmed);
    setText('');
  }

  function speak(textToRead: string) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(textToRead.replace(/\n/g, '。'));
    utterance.lang = 'zh-CN';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  }

  // TTS 只读主气泡（评审 P1-5）：记录回执与隐私行是小字辅助信息，不必念给老人听。
  function mainSpeechText(m: ChatMessage): string {
    return m.blocks?.find((block) => block.kind === 'main')?.text ?? m.text;
  }

  return (
    <div id={id} className="chat-view">
      <div className="chat-intro">
        <div className="agent-greeting">
          我是<b>阿安</b>，您的健康小助手。身体有什么不舒服、心里有什么话，都可以跟我说。
          {deviceNote === 'demo'
            ? '现在手表、血压等设备还没有真正连进来，页面里看到的设备数据是演示数据，不代表您刚刚测量的结果。'
            : '您说的话和记录都只保存在这台设备里。'}
        </div>
      </div>

      <div className="chat-list" ref={chatListRef}>
        {chat.map((m) => (
          <div key={m.id} className={`chat-row ${m.role === 'elder' ? 'row-elder' : 'row-agent'}`}>
            {m.role === 'agent' && <div className="chat-avatar">安</div>}
            <div className="chat-bubble">
              {m.blocks
                ? m.blocks.map((block, i) =>
                    block.kind === 'main' ? (
                      <div key={i} className="chat-main">
                        {block.text.split('\n').map((line, lineIndex) => (
                          <p key={lineIndex}>{line}</p>
                        ))}
                      </div>
                    ) : (
                      <p key={i} className={block.kind === 'receipt' ? 'chat-receipt' : 'chat-privacy'}>
                        {block.text}
                      </p>
                    ),
                  )
                : m.text.split('\n').map((line, i) => <p key={i}>{line}</p>)}
              <div className="chat-time">{m.time}</div>
              {m.role === 'agent' && ttsSupported && (
                <button className="btn-secondary" onClick={() => speak(mainSpeechText(m))} aria-label="朗读这条回复">
                  🔊 朗读
                </button>
              )}
              {m.role === 'agent' && m.safetyAction && <SafetyActions profile={profile} />}
              {m.role === 'agent' && m.toolTarget && (
                <a className="chat-tool-target" href={m.toolTarget.url} target="_blank" rel="noreferrer">
                  <span>{m.toolTarget.label}</span>
                  <small>来自家庭空间</small>
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="chat-quick">
        {quickInputs.map((q) => (
          <button key={q} className="chip" onClick={() => send(q)}>
            {q}
          </button>
        ))}
      </div>

      {voiceOpen && <VoiceListeningDialog onClose={() => setVoiceOpen(false)} onText={send} />}

      <div className="chat-input-row">
        <button
          className="btn-secondary"
          onClick={() => setVoiceOpen(true)}
          aria-label="开始说话"
          aria-haspopup="dialog"
        >
          说话
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
    </div>
  );
}
