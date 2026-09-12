import { useEffect, useRef, useState } from 'react';

/** Browser speech adapter: never pretend a recording was sent when permission or recognition fails. */
export default function HoldToTalk({ onText, compact = false }: { onText: (text: string) => void; compact?: boolean }) {
  const [status, setStatus] = useState('长按说话，松开发送');
  const [listening, setListening] = useState(false);
  const recognition = useRef<InstanceType<NonNullable<Window['SpeechRecognition']>> | null>(null);
  const cancelled = useRef(false);
  useEffect(
    () => () => {
      cancelled.current = true;
      recognition.current?.stop();
    },
    [],
  );
  function start() {
    if (recognition.current) return;
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) {
      setStatus('此浏览器不支持语音识别，请使用文字输入或手机键盘听写。');
      return;
    }
    cancelled.current = false;
    const rec = new Ctor();
    recognition.current = rec;
    let transcript = '';
    let failed = false;
    rec.lang = 'zh-CN';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (event) => {
      transcript = Array.from({ length: event.results.length }, (_, i) => event.results[i][0].transcript).join('');
      setStatus(transcript || '正在听…');
    };
    rec.onerror = (event) => {
      failed = true;
      setStatus(
        event.error === 'not-allowed' ? '麦克风未获授权，请在浏览器设置中允许。' : '未能识别，请重试或输入文字。',
      );
    };
    rec.onend = () => {
      recognition.current = null;
      setListening(false);
      if (!cancelled.current && !failed && transcript.trim()) onText(transcript.trim());
      else if (!failed) setStatus('未发送。长按后说话，松开发送。');
    };
    try {
      rec.start();
      setListening(true);
      setStatus('正在听…松开发送，按 Esc 取消');
    } catch {
      recognition.current = null;
      setStatus('语音服务无法启动，请输入文字。');
    }
  }
  function stop(cancel = false) {
    if (cancel) cancelled.current = true;
    recognition.current?.stop();
  }
  return (
    <div className={`hold-talk ${compact ? 'hold-talk-compact' : ''}`}>
      <button
        type="button"
        className={`hold-mic ${listening ? 'is-listening' : ''}`}
        aria-label="长按说话"
        aria-pressed={listening}
        onClick={() => (recognition.current ? stop() : start())}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
            e.preventDefault();
            start();
          }
          if (e.key === 'Escape') stop(true);
        }}
        onKeyUp={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            stop();
          }
        }}
      >
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <rect x="17" y="6" width="14" height="25" rx="7" />
          <path d="M11 24v2a13 13 0 0 0 26 0v-2M24 39v5M17 44h14" />
        </svg>
      </button>
      <p role="status">{listening ? '正在听…再次点击停止并发送' : status}</p>
    </div>
  );
}
