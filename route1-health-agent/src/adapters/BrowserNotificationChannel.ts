/**
 * 浏览器系统通知渠道：把家属通知推出页面之外，送达操作系统的通知中心。
 * 每种失败都返回明确的失败原因，绝不静默假装送达。
 * 真实产品还需要服务端推送 / 短信渠道覆盖「App 未打开」的场景，当前 Demo 阶段如实标注。
 */
import type { DeliveryOutcome } from '../engine/notify';

export type PushPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export function pushPermission(): PushPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as PushPermission;
}

export async function requestPushPermission(): Promise<PushPermission> {
  const current = pushPermission();
  if (current === 'unsupported' || current === 'granted') return current;
  try {
    return (await Notification.requestPermission()) as PushPermission;
  } catch {
    return 'denied';
  }
}

export function sendBrowserPush(tag: string, title: string, body: string): DeliveryOutcome {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { channel: 'browser_push', status: 'unavailable', detail: '当前浏览器不支持系统通知' };
  }
  if (Notification.permission === 'denied') {
    return {
      channel: 'browser_push',
      status: 'unavailable',
      detail: '系统通知权限已被拒绝，需在浏览器设置中允许本站通知',
    };
  }
  if (Notification.permission !== 'granted') {
    return { channel: 'browser_push', status: 'unavailable', detail: '尚未开启系统通知权限，请在家属端点击开启' };
  }
  try {
    new Notification(title, { body, tag });
    return { channel: 'browser_push', status: 'sent', detail: '已推送到系统通知中心' };
  } catch (error) {
    return {
      channel: 'browser_push',
      status: 'failed',
      detail: error instanceof Error ? error.message : '系统通知发送失败',
    };
  }
}
