import assert from 'node:assert/strict';
import { startVoiceRecognition, type SpeechRecognitionLike, type RecognitionEvent } from '../src/voice';

function setup(timeout = 1000) {
  let starts = 0;
  let stops = 0;
  let aborts = 0;
  const states: string[] = [];
  const messages: string[] = [];
  const drafts: string[] = [];
  const completed: string[] = [];
  const recognition: SpeechRecognitionLike = {
    lang: '',
    interimResults: false,
    continuous: false,
    onstart: null,
    onaudiostart: null,
    onspeechstart: null,
    onresult: null,
    onerror: null,
    onend: null,
    start() {
      starts++;
    },
    stop() {
      stops++;
    },
    abort() {
      aborts++;
    },
  };
  const session = startVoiceRecognition(
    recognition,
    {
      state: (state, message) => {
        states.push(state);
        messages.push(message);
      },
      transcript: (value) => drafts.push(value),
      complete: (value) => completed.push(value),
    },
    timeout,
  );
  const result = (...parts: [string, boolean][]) =>
    recognition.onresult?.({
      results: parts.map(([transcript, isFinal]) => ({ isFinal, 0: { transcript } })),
    });
  return {
    recognition,
    session,
    states,
    messages,
    drafts,
    completed,
    result,
    starts: () => starts,
    stops: () => stops,
    aborts: () => aborts,
  };
}

async function main() {
  const run = setup();
  assert.equal(run.states.at(-1), 'starting');
  assert.equal(run.recognition.continuous, true);
  assert.equal(run.recognition.interimResults, true);
  run.recognition.onstart?.();
  run.result(['昨晚起', false]);
  assert.equal(run.drafts.at(-1), '昨晚起');
  run.result(['昨晚起夜三次。', true], ['今天', false]);
  run.result(['昨晚起夜三次。', true], ['今天走了六千步。', true]);
  assert.equal(run.drafts.at(-1), '昨晚起夜三次。今天走了六千步。');
  assert.equal(run.states.at(-1), 'listening', 'final sentence must not end recording');
  run.recognition.onend?.(); // Browser ends at a pause: restart within the user's recording.
  assert.equal(run.starts(), 2);
  assert.equal(run.completed.length, 0);
  run.recognition.onstart?.();
  run.result(['还有一点累。', true]);
  assert.equal(run.drafts.at(-1), '昨晚起夜三次。今天走了六千步。 还有一点累。');
  run.session.stop();
  run.session.stop();
  assert.equal(run.stops(), 1);
  run.recognition.onend?.();
  assert.equal(run.completed.length, 1);
  assert.equal(run.starts(), 2, 'manual stop must never restart');
  assert.equal(run.aborts(), 1);

  const failed = setup();
  failed.recognition.onstart?.();
  failed.result(['保留这句话', false]);
  const lateResult = failed.recognition.onresult;
  const lateEnd = failed.recognition.onend;
  failed.recognition.onerror?.({ error: 'network' });
  lateEnd?.();
  lateResult?.({ results: [{ isFinal: true, 0: { transcript: '过期内容' } }] } as RecognitionEvent);
  assert.equal(failed.drafts.at(-1), '保留这句话');
  assert.equal(failed.starts(), 1, 'network failures must not restart');
  assert.equal(failed.completed.length, 0);
  assert.match(failed.messages.at(-1)!, /连接失败/);

  const cancelled = setup();
  const cancelledEnd = cancelled.recognition.onend;
  cancelled.session.cancel();
  cancelledEnd?.();
  assert.equal(cancelled.starts(), 1);
  assert.equal(cancelled.completed.length, 0);

  const silent = setup();
  silent.recognition.onstart?.();
  silent.recognition.onerror?.({ error: 'no-speech' });
  silent.recognition.onend?.();
  silent.recognition.onstart?.();
  silent.recognition.onend?.();
  assert.equal(silent.starts(), 2, 'empty sessions cannot retry indefinitely');
  assert.equal(silent.states.at(-1), 'error');

  const stalled = setup(5);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(stalled.states.at(-1), 'error');
  assert.equal(stalled.aborts(), 1);
  console.log('PASS: live revisions, long speech, restart, stop, cancel, errors and startup timeout');
}
void main();
