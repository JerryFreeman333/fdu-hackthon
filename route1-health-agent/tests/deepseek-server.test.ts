import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createDeepseekHandler } from '../server/deepseek';
import { emptyProfile } from '../src/engine/profile';

test('local DeepSeek backend validates updates and handles provider failures without leaking credentials', async () => {
  let status = 200;
  let calls = 0;
  let upstream = '';
  const fakeFetch = (async (_url, options) => {
    calls++;
    upstream = String(options?.body);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                reply: '请确认。',
                updates: [{ field: 'mobility', answer: '自己能走', source: '自己走' }],
              }),
            },
          },
        ],
      }),
      { status },
    );
  }) as typeof fetch;
  const config = { DEEPSEEK_API_KEY: 'test-only-placeholder' };
  const server = createServer(createDeepseekHandler(config, fakeFetch));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const body = { mode: 'profile', userText: '自己走', question: '平时走路需要帮助吗？', profile: emptyProfile };
  const post = (value: object) =>
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  try {
    assert.equal((await fetch(url + '/status').then((r) => r.json())).configured, true);
    const good = await post(body);
    assert.equal(good.status, 200);
    assert.equal((await good.json()).updates[0].answer, '自己能走');
    assert.equal(JSON.parse(upstream).response_format.type, 'json_object');
    const callsBefore = calls;
    assert.equal((await post({ ...body, userText: '不要记录，我自己走' })).status, 400);
    assert.equal(calls, callsBefore, 'no-record input must not reach the provider');
    assert.equal((await post({ ...body, profile: { ...emptyProfile, age: 200 } })).status, 400);
    status = 401;
    const failed = await post(body);
    assert.equal(failed.status, 502);
    const error = await failed.text();
    assert.ok(error.includes('密钥无效'));
    assert.ok(!error.includes('test-only-placeholder'));
    status = 200;
    const noEvidence = await post({ ...body, userText: '其他话' });
    assert.equal(noEvidence.status, 502);
    config.DEEPSEEK_API_KEY = '';
    const beforeMissingKey = calls;
    assert.equal((await post(body)).status, 503);
    assert.equal(calls, beforeMissingKey);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
