/**
 * P1-D：理解层/回复层经过“本地代理 → OpenAI 兼容上游”的真实 HTTP 链路，
 * 以及 `.env.example` 可直接 cp 使用（无真实 key、无重复变量、端口一致）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { createHttpLlmAdapter } from '../src/engine/agent';
import { understandElderInputWithLlm } from '../src/engine/llmUnderstanding';
import { acceptedSelfClaims } from '../src/engine/understanding';

const TODAY = '2026-09-11';
const PROXY_SCRIPT = resolve(process.cwd(), 'scripts/local-llm-proxy.mjs');

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

function startUpstream(port: number): Promise<{ auth: string[]; paths: string[]; close: () => void }> {
  const captured = { auth: [] as string[], paths: [] as string[] };
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      captured.auth.push(req.headers.authorization ?? '');
      captured.paths.push(req.url ?? '');
      const body = JSON.parse(raw || '{}') as { messages?: Array<{ content?: string }> };
      const system = body.messages?.[0]?.content ?? '';
      const user = body.messages?.[1]?.content ?? '';
      const content = system.includes('中文口语理解器')
        ? user.includes('不太喘')
          ? '[{"i":0,"s":"negated"}]'
          : '[{"i":0,"s":"occurred"}]'
        : '先坐下来休息，我记下了。';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  return new Promise((done) => {
    server.listen(port, '127.0.0.1', () =>
      done({
        auth: captured.auth,
        paths: captured.paths,
        close: () => server.close(),
      }),
    );
  });
}

async function proxyReady(port: number): Promise<boolean> {
  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST' });
      if (response.status === 404) return true;
    } catch {
      // 代理还在启动。
    }
    await wait(100);
  }
  return false;
}

test('.env.example is copy-ready and keeps real provider keys out of VITE variables', () => {
  const text = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8');
  const entries = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=');
      assert.ok(index > 0, `非注释行必须是 KEY=VALUE：${line}`);
      return { key: line.slice(0, index).trim(), value: line.slice(index + 1).trim() };
    });
  const keys = entries.map((entry) => entry.key);
  assert.equal(new Set(keys).size, keys.length, '重复变量会互相覆盖');
  const values = new Map(entries.map((entry) => [entry.key, entry.value]));
  assert.equal(values.get('VITE_UNDERSTANDING_LLM_BASE_URL'), 'http://localhost:8788');
  assert.equal(values.get('VITE_UNDERSTANDING_LLM_API_KEY'), 'proxy');
  assert.equal(values.get('VITE_PEER_SIGNALING_URL'), '');
  assert.equal(values.get('VITE_AGENT_LLM_ENDPOINT'), '');
  assert.doesNotMatch(text, /sk-[A-Za-z0-9]{8,}/, '样例文件不得包含真实厂商 key');
  assert.doesNotMatch(text, /然后填:\s*#/, '样例文件不得包含被拼接坏的注释行');

  const proxy = readFileSync(PROXY_SCRIPT, 'utf8');
  assert.match(proxy, /LLM_PROXY_PORT \?\? 8788/, '样例中的 8788 必须与代理默认端口一致');
});

void test('理解层与回复层经过本地代理的真实 HTTP 链路', async () => {
  const upstreamPort = await freePort();
  let proxyPort = await freePort();
  while (proxyPort === upstreamPort) proxyPort = await freePort();
  const upstream = await startUpstream(upstreamPort);
  const child = spawn(process.execPath, [PROXY_SCRIPT], {
    env: {
      ...process.env,
      LLM_PROXY_API_KEY: 'test-upstream-key',
      LLM_PROXY_UPSTREAM_URL: `http://127.0.0.1:${upstreamPort}`,
      LLM_PROXY_PORT: String(proxyPort),
      LLM_PROXY_MODEL: 'test-model',
    },
    stdio: 'ignore',
  });
  try {
    assert.ok(await proxyReady(proxyPort), '本地 LLM 代理应在 6 秒内就绪');
    const config = {
      baseUrl: `http://127.0.0.1:${proxyPort}`,
      apiKey: 'browser-placeholder',
      model: 'test-model',
      timeoutMs: 3000,
    };

    const negated = await understandElderInputWithLlm('今天不太喘了', TODAY, [], config);
    assert.equal(acceptedSelfClaims(negated).length, 0, 'LLM 仲裁后的否定不得进入事实流');
    const positive = await understandElderInputWithLlm('我今天有点喘', TODAY, [], config);
    assert.equal(acceptedSelfClaims(positive).length, 1, '阳性症状照常进入事实流');

    const adapter = createHttpLlmAdapter(`http://127.0.0.1:${proxyPort}/agent/chat`, 3000);
    const reply = await adapter.complete('你是老人健康助手', '我有点头晕', undefined);
    assert.equal(reply.text, '先坐下来休息，我记下了。');
    assert.deepEqual(reply.tags, [], '代理未提供标签时应返回空数组，由客户端规则兜底');

    assert.equal(upstream.auth.length, 3);
    for (const auth of upstream.auth) {
      assert.equal(auth, 'Bearer test-upstream-key', '代理必须注入真实上游 key');
      assert.ok(!auth.includes('browser-placeholder'), '浏览器占位 key 不得发往上游');
    }
    for (const path of upstream.paths)
      assert.equal(path, '/chat/completions', '/agent/chat 应转换为上游 chat/completions');
  } finally {
    child.kill('SIGTERM');
    upstream.close();
  }
});
