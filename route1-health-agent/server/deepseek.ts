import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PROFILE_UNDERSTANDING_PROMPT, parseProfileUnderstanding } from '../src/engine/profileUnderstanding';
import { validateProfile } from '../src/engine/profile';
import { parsePrivacyIntent } from '../src/engine/privacy';

export function createDeepseekHandler(env: Record<string, string>, fetcher: typeof fetch = fetch) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: object) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/status')
      return send(200, {
        configured: Boolean(env.DEEPSEEK_API_KEY?.trim()),
        model: env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
      });
    if (req.method !== 'POST') return send(405, { error: '请使用 POST 请求。' });
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)
      return send(403, { error: '只接受本地页面请求。' });
    if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: '请求格式不正确。' });
    let size = 0;
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 64000) return send(413, { error: '消息内容过长。' });
        chunks.push(Buffer.from(chunk));
      }
      let input;
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return send(400, { error: '请求格式不正确。' });
      }
      if (!input || typeof input.userText !== 'string' || !input.userText.trim() || input.userText.length > 1000)
        return send(400, { error: '消息格式或长度不正确。' });
      if (['private', 'no_record'].includes(parsePrivacyIntent(input.userText)))
        return send(400, { error: '这条消息涉及不外传或不记录意愿，已留在本地，未发送给 DeepSeek。' });
      if (!env.DEEPSEEK_API_KEY?.trim())
        return send(503, { error: '尚未配置 DeepSeek 密钥，请填写 .env.local 后重启服务。' });
      const intake = input.mode === 'profile';
      let profile;
      if (intake) {
        try {
          profile = validateProfile(input.profile);
          if (typeof input.question !== 'string' || input.question.length > 500) throw new Error();
        } catch {
          return send(400, { error: '基本资料或当前问题格式不正确。' });
        }
      } else if (typeof input.systemPrompt !== 'string' || input.systemPrompt.length > 4000) {
        return send(400, { error: '对话规则格式不正确。' });
      }
      const history = input.history ?? [];
      if (
        !Array.isArray(history) ||
        history.length > 12 ||
        history.some(
          (item) =>
            !item ||
            !['user', 'assistant'].includes(item.role) ||
            typeof item.content !== 'string' ||
            item.content.length > 1000,
        )
      )
        return send(400, { error: '对话历史格式不正确。' });
      const response = await fetcher('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        signal: AbortSignal.timeout(25000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.DEEPSEEK_API_KEY.trim()}` },
        body: JSON.stringify({
          model: env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
          messages: [
            {
              role: 'system',
              content: intake
                ? PROFILE_UNDERSTANDING_PROMPT
                : '你是阿安，面向老年人的日常助手。温和简短，不做诊断或指导改药。你不能拨号、发送消息或实际联系任何人，不得声称已经或将替用户联系家属、医生或社区。以下是应用提供的规则：\n' +
                  input.systemPrompt,
            },
            ...(intake ? [] : history.map((item) => ({ role: item.role, content: item.content }))),
            {
              role: 'user',
              content: JSON.stringify(
                intake
                  ? { userText: input.userText, profile, question: input.question }
                  : { message: input.userText, background: input.context ?? null },
              ),
            },
          ],
          ...(intake ? { response_format: { type: 'json_object' } } : {}),
          thinking: { type: 'disabled' },
          stream: false,
          max_tokens: intake ? 1400 : 700,
        }),
      });
      if (!response.ok)
        return send(502, {
          error:
            response.status === 401
              ? 'DeepSeek 密钥无效，请检查配置。'
              : response.status === 402
                ? 'DeepSeek 账户余额不足。'
                : response.status === 429
                  ? 'DeepSeek 请求过于频繁，请稍后重试。'
                  : 'DeepSeek 暂时无法回复，请稍后重试。',
        });
      const result = (await response.json()) as { choices?: { message?: { content?: string } }[] };
      const text = result.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) return send(502, { error: 'DeepSeek 没有返回有效回复。' });
      if (intake && profile) {
        try {
          const parsed = JSON.parse(text);
          parseProfileUnderstanding(parsed, profile, input.userText);
          return send(200, parsed);
        } catch {
          return send(502, { error: 'DeepSeek 的资料提取未通过校验，尚未保存。请重新说明。' });
        }
      }
      send(200, { text });
    } catch {
      send(502, { error: '连接 DeepSeek 超时或失败，请稍后重试。' });
    }
  };
}

/** Development backend only; deployment needs an equivalent server endpoint. */
export function deepseekPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'local-deepseek',
    configureServer(server) {
      server.middlewares.use('/api/agent', createDeepseekHandler(env));
    },
  };
}
