/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEVICE_MODE?: 'demo' | 'healthkit';
  readonly VITE_HEALTHKIT_ENDPOINT?: string;
  readonly VITE_HEALTHKIT_USER_ID?: string;
  readonly VITE_HEALTHKIT_BRIDGE_TOKEN?: string;
  readonly VITE_AGENT_LLM_ENDPOINT?: string;
  /**
   * 真实视觉模型服务端代理地址。
   * 该 endpoint 必须由我们自己或可信任方运维；不应把任何供应商 API Key 写进浏览器环境变量。
   * 例如：
   *   VITE_HEALTH_VISION_ENDPOINT=/api/health/image-parse
   */
  readonly VITE_HEALTH_VISION_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
