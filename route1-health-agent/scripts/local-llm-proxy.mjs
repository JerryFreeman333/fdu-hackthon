/**
 * 本地 LLM 代理（评审 P0-5：让厂商 API key 不进浏览器 bundle）。
 *
 * 背景：理解层的 Demo 直连模式把 VITE_UNDERSTANDING_LLM_API_KEY 经 Vite 内联进
 * 浏览器产物，任何打开页面的人都可以提取。本代理把 key 留在本机 Node 进程里，
 * 浏览器只访问 http://localhost:<port>。
 *
 * 用法：
 *   LLM_PROXY_API_KEY=你的key npm run proxy
 * 然后在 .env 里改成代理模式（key 填占位符即可，代理会替换成真实 key）：
 *   VITE_UNDERSTANDING_LLM_BASE_URL=http://localhost:8787
 *   VITE_UNDERSTANDING_LLM_API_KEY=proxy
 *   VITE_UNDERSTANDING_LLM_MODEL=你的模型名
 * 回复层适配器（可选）：
 *   VITE_AGENT_LLM_ENDPOINT=http://localhost:8787/agent/chat
 *
 * 环境变量：
 *   LLM_PROXY_API_KEY      必填，上游厂商 key（只存在于本进程）
 *   LLM_PROXY_UPSTREAM_URL 默认 https://api.minimaxi.com/v1（任何 OpenAI 兼容端点）
 *   LLM_PROXY_PORT         默认 8787
 *   LLM_PROXY_MODEL        /agent/chat 未显式传 model 时的默认模型
 */
import http from 'node:http';

const PORT = Number(process.env.LLM_PROXY_PORT ?? 8787);
const UPSTREAM = (process.env.LLM_PROXY_UPSTREAM_URL ?? 'https://api.minimaxi.com/v1').replace(/\/+$/, '');
const API_KEY = process.env.LLM_PROXY_API_KEY ?? '';

if (!API_KEY) {
  console.error('[llm-proxy] 缺少 LLM_PROXY_API_KEY 环境变量，拒绝启动（代理的意义就是持有真实 key）。');
  process.exit(1);
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

/** 调上游 /chat/completions；任何网络/HTTP 错误都以 502 + 明确 message 返回，绝不静默。 */
async function callUpstream(payload) {
  const response = await fetch(`${UPSTREAM}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`上游返回 ${response.status}：${text.slice(0, 300)}`);
  }
  return text;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }
  const pathname = (req.url ?? '').split('?')[0];
  if (req.method !== 'POST' || (pathname !== '/chat/completions' && pathname !== '/agent/chat')) {
    res.writeHead(404, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '只有 POST /chat/completions 与 POST /agent/chat 两个端点' }));
    return;
  }
  try {
    const raw = await readBody(req);
    if (pathname === '/chat/completions') {
      // 理解层透传：请求体原样，key 由代理注入。
      const text = await callUpstream(JSON.parse(raw));
      res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(text);
      return;
    }
    // /agent/chat：useElderChat 的 createHttpLlmAdapter 契约 {systemPrompt, userText}
    // → OpenAI 格式 → 契约回包 {text, tags}（tags 缺省时客户端按规则解析兜底）。
    const body = JSON.parse(raw);
    const model = body.model ?? process.env.LLM_PROXY_MODEL ?? 'glm-4-flash';
    const text = await callUpstream({
      model,
      temperature: 0.3,
      stream: false,
      messages: [
        { role: 'system', content: body.systemPrompt ?? '' },
        { role: 'user', content: body.userText ?? '' },
      ],
    });
    const payload = JSON.parse(text);
    const reply = payload?.choices?.[0]?.message?.content ?? '';
    res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ text: reply, tags: [] }));
  } catch (error) {
    res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : '代理请求失败' }));
  }
});

server.listen(PORT, () => {
  console.log(`[llm-proxy] 已启动：http://localhost:${PORT}（上游：${UPSTREAM}，key 只在本进程内）`);
});
