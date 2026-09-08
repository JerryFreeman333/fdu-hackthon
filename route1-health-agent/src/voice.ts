export type VoiceState = 'ready' | 'starting' | 'listening' | 'processing' | 'unsupported' | 'error';

type RecognitionResult = { isFinal: boolean; [index: number]: { transcript: string } };
export type RecognitionEvent = { results: { length: number; [index: number]: RecognitionResult } };
export interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

export function voiceErrorMessage(error: string): string {
  switch (error) {
    case 'not-allowed':
      return '麦克风未获允许。请检查网站麦克风权限和 Windows 的麦克风隐私设置。';
    case 'service-not-allowed':
      return '浏览器不允许使用语音识别服务。允许麦克风不代表识别服务可用，请用独立浏览器打开页面再试。';
    case 'network':
      return '语音识别服务连接失败。麦克风可能已打开，但声音没有转成文字；请检查网络后重试。';
    case 'audio-capture':
      return '无法读取麦克风。请检查系统选中的输入设备，或关闭占用麦克风的程序后重试。';
    case 'no-speech':
      return '没有识别到说话。请靠近麦克风再试，或检查系统输入设备是否有声音。';
    case 'language-not-supported':
      return '当前浏览器的语音服务不支持中文识别，请换用支持中文的语音输入。';
    case 'timeout':
      return '语音识别迟迟没有返回文字，已停止录音。允许麦克风后，浏览器识别服务仍可能不可用。';
    default:
      return `语音识别中断（${error}）。已有文字会保留，请检查后发送或重试。`;
  }
}

// Browser sessions can end at a pause. Keep the user's recording open until Stop,
// but never retry permission/network failures or submit unfinished text.
export function startVoiceRecognition(
  recognition: SpeechRecognitionLike,
  callbacks: {
    state: (state: VoiceState, message: string) => void;
    transcript: (text: string) => void;
    complete: (text: string) => void;
  },
  timeoutMs = 12000,
) {
  let closed = false;
  let stopping = false;
  let previous = '';
  let segment = '';
  let emptySessions = 0;
  let timer: ReturnType<typeof setTimeout>;

  function release() {
    closed = true;
    clearTimeout(timer);
    recognition.onstart = recognition.onaudiostart = recognition.onspeechstart = null;
    recognition.onresult = recognition.onend = recognition.onerror = null;
    try {
      recognition.abort();
    } catch {
      /* Already stopped. */
    }
  }
  function fail(error: string) {
    if (closed) return;
    release();
    callbacks.state('error', voiceErrorMessage(error));
  }
  function armTimeout() {
    clearTimeout(timer);
    timer = setTimeout(() => fail('timeout'), timeoutMs);
  }
  function stop() {
    if (closed || stopping) return;
    stopping = true;
    callbacks.state('processing', '正在整理最后一句…');
    armTimeout();
    try {
      recognition.stop();
    } catch {
      fail('aborted');
    }
  }
  function begin() {
    callbacks.state('starting', previous ? '正在继续录音，前面的文字已保留…' : '正在启动语音，请稍候…');
    armTimeout();
    try {
      recognition.start();
    } catch {
      fail('start-failed');
    }
  }

  recognition.lang = 'zh-CN';
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.onstart = () => {
    if (closed || stopping) return;
    clearTimeout(timer);
    callbacks.state('listening', '正在听，您可以停顿后继续。全部说完再点“说完了”。');
  };
  recognition.onaudiostart = () => {
    if (!closed && !stopping) callbacks.state('listening', '麦克风已打开，识别文字会边说边显示。说完请点“说完了”。');
  };
  recognition.onspeechstart = () => {
    if (!closed && !stopping) callbacks.state('listening', '正在听，文字可能继续修正…');
  };
  recognition.onresult = (event) => {
    if (closed) return;
    // Each event includes the current session's cumulative results. Replace it,
    // rather than append it, so interim revisions and final words aren't duplicated.
    segment = Array.from(
      { length: event.results.length },
      (_, index) => event.results[index][0]?.transcript ?? '',
    ).join('');
    callbacks.transcript([previous, segment.trim()].filter(Boolean).join(' '));
  };
  recognition.onerror = (event) => {
    if (event.error !== 'no-speech' || stopping) fail(event.error ?? 'unknown');
  };
  recognition.onend = () => {
    if (closed) return;
    const result = [previous, segment.trim()].filter(Boolean).join(' ');
    if (stopping) {
      release();
      if (result) {
        callbacks.state('ready', '文字已保留，请检查识别结果，改好后再发送。');
        callbacks.complete(result);
      } else callbacks.state('error', voiceErrorMessage('no-speech'));
      return;
    }
    emptySessions = segment.trim() ? 0 : emptySessions + 1;
    previous = result;
    segment = '';
    if (emptySessions >= 2) {
      fail('no-speech');
      return;
    }
    begin();
  };
  begin();
  return { stop, cancel: release };
}
