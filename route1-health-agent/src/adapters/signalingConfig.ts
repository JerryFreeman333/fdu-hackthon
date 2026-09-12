/**
 * PeerJS 信令与 ICE 配置。
 *
 * PeerJS 默认使用官方公共信令（0.peerjs.com）+ Google 公共 STUN——两者在中国大陆
 * 网络环境下都不稳定，是"两台手机实时协同"这个核心卖点的真实风险点（审查反馈）。
 *
 * 本模块允许通过环境变量把信令指向自建/国内可达的 peerjs-server，
 * 并可替换 STUN/TURN 列表；未配置时保持官方默认并附加一个国内可达的公共 STUN。
 * 解析逻辑是纯函数，便于单元测试；不引入 peerjs 依赖。
 */

export interface SignalingOptions {
  host: string;
  port: number;
  path: string;
  secure: boolean;
}

/** 解析 wss/ws/https/http 形式的信令地址为 PeerJS client 选项；非法输入返回 null。 */
export function parseSignalingUrl(raw: string): SignalingOptions | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    const secure = parsed.protocol === 'https:' || parsed.protocol === 'wss:';
    const insecure = parsed.protocol === 'http:' || parsed.protocol === 'ws:';
    if (!secure && !insecure) return null;
    if (!parsed.hostname) return null;
    const port = parsed.port ? Number(parsed.port) : secure ? 443 : 80;
    if (!Number.isFinite(port) || port <= 0 || port > 65535) return null;
    let path = parsed.pathname.replace(/\/+$/, '');
    if (path && !path.startsWith('/')) path = `/${path}`;
    return { host: parsed.hostname, port, path: path || '/', secure };
  } catch {
    return null;
  }
}

/** 国内可达的公共 STUN（腾讯），与 Google STUN 并列作为默认，任一可用即可完成 NAT 探测。 */
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.qq.com:3478' },
];

/** 从环境读取 ICE 服务器列表（JSON 数组）；非法输入返回 null（= 用默认列表）。 */
export function parseIceServers(raw: string | undefined): RTCIceServer[] | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed.filter((entry) => typeof entry === 'object' && entry !== null) as RTCIceServer[];
  } catch {
    return null;
  }
}
