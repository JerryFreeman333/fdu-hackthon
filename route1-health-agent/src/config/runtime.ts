export type DeviceMode = 'demo' | 'healthkit';
export type HealthVisionMode = 'demo' | 'real';
export type AgentMode = 'rule' | 'llm';

function enumValue<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  if (!value) return fallback;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`无效运行模式“${value}”，允许值：${allowed.join(' | ')}`);
}

export const runtimeConfig = {
  deviceMode: enumValue(import.meta.env.VITE_DEVICE_MODE, ['demo', 'healthkit'] as const, 'demo'),
  healthkitEndpoint: (
    import.meta.env.VITE_HEALTHKIT_ENDPOINT || 'http://localhost:8787/api/healthkit/measurements'
  ).trim(),
  healthkitUserId: (import.meta.env.VITE_HEALTHKIT_USER_ID || '现场测试用户').trim(),
  healthkitBridgeToken: import.meta.env.VITE_HEALTHKIT_BRIDGE_TOKEN?.trim() ?? '',
  healthVisionMode: enumValue(import.meta.env.VITE_HEALTH_VISION_MODE, ['demo', 'real'] as const, 'demo'),
  healthVisionEndpoint: import.meta.env.VITE_HEALTH_VISION_ENDPOINT,
  agentMode: enumValue(import.meta.env.VITE_AGENT_MODE, ['rule', 'llm'] as const, 'rule'),
  agentEndpoint: import.meta.env.VITE_AGENT_LLM_ENDPOINT,
} as const;

export function runtimeConfigurationErrors(): string[] {
  const errors: string[] = [];
  if (runtimeConfig.deviceMode === 'healthkit') {
    if (!runtimeConfig.healthkitUserId) errors.push('VITE_DEVICE_MODE=healthkit 时，VITE_HEALTHKIT_USER_ID 不能为空');
    try {
      const url = new URL(runtimeConfig.healthkitEndpoint);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('invalid protocol');
    } catch {
      errors.push('VITE_DEVICE_MODE=healthkit 时，VITE_HEALTHKIT_ENDPOINT 必须是非空的 http/https 完整 URL');
    }
  }
  if (runtimeConfig.healthVisionMode === 'real' && !runtimeConfig.healthVisionEndpoint) {
    errors.push('VITE_HEALTH_VISION_MODE=real 时必须配置 VITE_HEALTH_VISION_ENDPOINT');
  }
  if (runtimeConfig.agentMode === 'llm' && !runtimeConfig.agentEndpoint) {
    errors.push('VITE_AGENT_MODE=llm 时必须配置 VITE_AGENT_LLM_ENDPOINT');
  }
  return errors;
}
