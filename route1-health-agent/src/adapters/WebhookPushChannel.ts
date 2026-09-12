/**
 * 微信 webhook 推送渠道（评审 P0-6/P1-3：通知"最后一公里"）。
 *
 * 浏览器系统通知只在网页开着时可见；本渠道通过 Server酱 / PushPlus 等
 * 推送服务把紧急通知送到家属的微信里，不依赖页面打开。
 *
 * 诚实边界：当前通知由配置了 token 的这台设备发出；正式版应由服务端
 * 持有 token 发送。配置只存在本机 localStorage，绝不入库。
 */
import type { DeliveryOutcome } from '../engine/notify';

export type WebhookProvider = 'serverchan' | 'pushplus' | 'custom';

export interface WebhookPushConfig {
  provider: WebhookProvider;
  /** Server酱 SendKey / PushPlus token / 自定义通道标识。 */
  token: string;
  /** provider === 'custom' 时的接收地址（https 或 localhost）。 */
  customUrl?: string;
}

const STORAGE_KEY = 'ankang-route1-webhook-push-v1';

export function loadWebhookConfig(): WebhookPushConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WebhookPushConfig>;
    if (typeof parsed.token !== 'string' || parsed.token.trim().length === 0) return null;
    return {
      provider: parsed.provider === 'pushplus' || parsed.provider === 'custom' ? parsed.provider : 'serverchan',
      token: parsed.token.trim(),
      customUrl: typeof parsed.customUrl === 'string' ? parsed.customUrl.trim() : undefined,
    };
  } catch {
    return null;
  }
}

export function saveWebhookConfig(config: WebhookPushConfig | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!config || config.token.trim().length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // 隐私模式：配置留在内存即可
  }
}

/** 按服务商解析接收地址；非法配置返回 null（调用方如实记为 unavailable）。 */
export function resolveWebhookUrl(config: WebhookPushConfig): string | null {
  if (config.provider === 'serverchan') {
    return config.token.trim().length > 0
      ? `https://sctapi.ftqq.com/${encodeURIComponent(config.token.trim())}.send`
      : null;
  }
  if (config.provider === 'pushplus') {
    return 'https://www.pushplus.plus/send';
  }
  if (config.provider === 'custom') {
    const url = (config.customUrl ?? '').trim();
    if (!url) return null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
        return url;
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

const TIMEOUT_MS = 10000;

/** 把一条通知推到家属微信；成功/失败/不可用都以 DeliveryOutcome 如实返回，绝不静默。 */
export async function sendWebhookPush(
  config: WebhookPushConfig,
  notification: { title: string; body: string },
  fetchImpl: typeof fetch = fetch,
): Promise<DeliveryOutcome> {
  const url = resolveWebhookUrl(config);
  if (!url) {
    return { channel: 'webhook_push', status: 'unavailable', detail: '微信推送配置不完整，请在家属端检查' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let response: Response;
    if (config.provider === 'serverchan') {
      // Server酱：form-encoded 的 title/desp；code === 0 视为成功。
      const form = new URLSearchParams({ title: notification.title, desp: notification.body });
      response = await fetchImpl(url, { method: 'POST', body: form, signal: controller.signal });
      const payload = (await response.json()) as { code?: number; message?: string };
      if (!response.ok || payload.code !== 0) {
        return {
          channel: 'webhook_push',
          status: 'failed',
          detail: `Server酱返回 ${response.status}：${payload.message ?? '未知错误'}`,
        };
      }
      return { channel: 'webhook_push', status: 'sent', detail: '已通过 Server酱 推送到微信' };
    }
    if (config.provider === 'pushplus') {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: config.token,
          title: notification.title,
          content: notification.body,
          template: 'txt',
        }),
        signal: controller.signal,
      });
      const payload = (await response.json()) as { code?: number; msg?: string };
      if (!response.ok || payload.code !== 200) {
        return {
          channel: 'webhook_push',
          status: 'failed',
          detail: `PushPlus 返回 ${response.status}：${payload.msg ?? '未知错误'}`,
        };
      }
      return { channel: 'webhook_push', status: 'sent', detail: '已通过 PushPlus 推送到微信' };
    }
    // custom：POST JSON {title, body}，2xx 即成功。
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: notification.title, body: notification.body }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { channel: 'webhook_push', status: 'failed', detail: `自定义通道返回 ${response.status}` };
    }
    return { channel: 'webhook_push', status: 'sent', detail: '已推送到自定义通道' };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      channel: 'webhook_push',
      status: 'failed',
      detail: aborted ? '微信推送超时（10 秒无响应）' : error instanceof Error ? error.message : '微信推送请求失败',
    };
  } finally {
    clearTimeout(timer);
  }
}
