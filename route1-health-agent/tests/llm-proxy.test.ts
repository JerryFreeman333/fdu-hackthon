/**
 * 评审 P0-5：本地 LLM 代理契约测试。
 * 锁定：/chat/completions 透传时 key 由代理注入（客户端无需携带）；
 * /agent/chat 按 createHttpLlmAdapter 契约返回 {text, tags}；预检带 CORS 头。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

const UPSTREAM_PORT = 18790;
const PROXY_PORT = 18791;
const SCRIPT = resolve(process.cwd(), 'scripts/local-llm-proxy.mjs');

function startUpstream(): Promise<{
  state: { capturedAuth: string; capturedPath: string };
  close: () => void;
}> {
  return new Promise((resolvePromise) => {
    const state = { capturedAuth: '', capturedPath: '' };
    const server = http.createServer((req, res) => {
      state.capturedAuth = req.headers.authorization ?? '';
      state.capturedPath = req.url ?? '';
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: '好的，我记下了。' } }] }));
      });
    });
    server.listen(UPSTREAM_PORT, () => resolvePromise({ state, close: () => server.close() }));
  });
}

function post(path: string, body: unknown): Promise<{ status: number; headers: http.IncomingHttpHeaders; json: any }> {
  const payload = JSON.stringify(body);
  return new Promise((resolvePromise, reject) => {
    const req = http.request(
      { host: 'localhost', port: PROXY_PORT, path, method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () =>
          resolvePromise({ status: res.statusCode ?? 0, headers: res.headers, json: JSON.parse(data) }),
        );
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

void test('本地 LLM 代理：透传注入 key、agent 契约与 CORS 预检', async () => {
  const upstream = await startUpstream();
  const child = spawn(process.execPath, [SCRIPT], {
    env: {
      ...process.env,
      LLM_PROXY_API_KEY: 'test-proxy-key',
      LLM_PROXY_UPSTREAM_URL: `http://localhost:${UPSTREAM_PORT}`,
      LLM_PROXY_PORT: String(PROXY_PORT),
    },
    stdio: 'ignore',
  });
  try {
    let ready = false;
    for (let i = 0; i < 40 && !ready; i += 1) {
      ready = await new Promise<boolean>((resolvePromise) => {
        const req = http.request({ host: 'localhost', port: PROXY_PORT, path: '/', method: 'POST' }, (res) => {
          res.resume();
          resolvePromise(res.statusCode === 404);
        });
        req.on('error', () => resolvePromise(false));
        req.end();
      });
      if (!ready) await wait(100);
    }
    assert.ok(ready, '代理应在 4 秒内就绪');

    // 预检：浏览器跨源访问 localhost 代理需要 CORS 头。
    const preflightStatus = await new Promise<number>((resolvePromise) => {
      const req = http.request(
        { host: 'localhost', port: PROXY_PORT, path: '/chat/completions', method: 'OPTIONS' },
        (res) => {
          res.resume();
          resolvePromise(res.statusCode ?? 0);
        },
      );
      req.end();
    });
    assert.equal(preflightStatus, 204, 'OPTIONS 预检应返回 204');

    // /chat/completions：客户端不带 key，代理注入。
    const passthrough = await post('/chat/completions', { model: 'test-model', messages: [] });
    assert.equal(passthrough.status, 200);
    assert.equal(upstream.state.capturedAuth, 'Bearer test-proxy-key', '代理必须把真实 key 注入上游 Authorization');
    assert.equal(passthrough.json.choices[0].message.content, '好的，我记下了。');

    // /agent/chat：按 {systemPrompt, userText} → {text, tags} 契约转换。
    const agent = await post('/agent/chat', { systemPrompt: 'sys', userText: '今天有点累' });
    assert.equal(agent.status, 200);
    assert.equal(agent.json.text, '好的，我记下了。');
    assert.deepEqual(agent.json.tags, []);
    assert.equal(upstream.state.capturedPath, '/chat/completions', 'agent 端点应转换为上游 chat/completions');
  } finally {
    child.kill('SIGTERM');
    upstream.close();
  }
});
