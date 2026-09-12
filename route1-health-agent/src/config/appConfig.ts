/**
 * 运行时配置单一入口（P2，评审：import.meta.env 散布在 hooks/adapters 多处，
 * 模块加载时定格与逐次读取混用，环境故事没有单一事实来源）。
 *
 * 所有 VITE_* 环境读取集中在这里，模块加载时求值一次（env 在运行期不变）。
 * 纯解析逻辑仍留在各自模块（llmUnderstanding.resolveUnderstandingLlmConfig、
 * signalingConfig.parse*），本模块只负责"读一次、给结论"；
 * 相关单测通过注入 env 对象覆盖这些纯函数。
 *
 * 测试构建（node:test）里 import.meta.env 为 undefined → 全部落默认值，
 * 行为与"未配置环境"完全一致。
 */
import { resolveUnderstandingLlmConfig, type UnderstandingLlmConfig } from '../engine/llmUnderstanding';
import {
  DEFAULT_ICE_SERVERS,
  parseIceServers,
  parseSignalingUrl,
  type SignalingOptions,
} from '../adapters/signalingConfig';

export interface AppConfig {
  /** 理解层 LLM（肯否/标签仲裁）；null = 纯规则模式。 */
  understandingLlm: UnderstandingLlmConfig | null;
  /** 回复层 LLM 端点（服务端代理）；null = 规则回复。 */
  agentLlmEndpoint: string | null;
  /** 回复层超时（毫秒），默认 12000。 */
  agentLlmTimeoutMs: number;
  /** 真实视觉服务端点；null = 拍照走 demo parser（personal 模式会被 demoPhotoRefusal 拒绝）。 */
  healthVisionEndpoint: string | null;
  /** PeerJS 信令与 ICE 配置。 */
  peer: {
    /** 解析后的自建信令；null = 官方公共信令。 */
    signaling: SignalingOptions | null;
    /** 原始配置串（非法时用于 console.warn）。 */
    signalingRaw: string | null;
    iceServers: RTCIceServer[];
  };
}

function readEnv(): Record<string, string | undefined> {
  return (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
}

const raw = readEnv();

const agentLlmEndpointRaw = raw.VITE_AGENT_LLM_ENDPOINT?.trim() || null;
const agentLlmTimeoutRaw = Number(raw.VITE_AGENT_LLM_TIMEOUT_MS);

export const appConfig: AppConfig = {
  understandingLlm: resolveUnderstandingLlmConfig(raw),
  agentLlmEndpoint: agentLlmEndpointRaw,
  agentLlmTimeoutMs:
    Number.isFinite(agentLlmTimeoutRaw) && agentLlmTimeoutRaw >= 1000 ? Math.min(agentLlmTimeoutRaw, 60000) : 12000,
  healthVisionEndpoint: raw.VITE_HEALTH_VISION_ENDPOINT?.trim() || null,
  peer: {
    signalingRaw: raw.VITE_PEER_SIGNALING_URL?.trim() || null,
    signaling: parseSignalingUrl(raw.VITE_PEER_SIGNALING_URL ?? ''),
    iceServers: parseIceServers(raw.VITE_PEER_ICE_SERVERS) ?? DEFAULT_ICE_SERVERS,
  },
};

/** P1-6（评审：承诺一致性）：理解层 LLM 是否已配置——决定"数据只保存在本机"类承诺的措辞。 */
export function understandingLlmConfigured(): boolean {
  return appConfig.understandingLlm !== null;
}
