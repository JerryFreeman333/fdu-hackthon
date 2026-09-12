/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEVICE_MODE?: 'demo' | 'healthkit';
  readonly VITE_HEALTHKIT_ENDPOINT?: string;
  readonly VITE_HEALTHKIT_USER_ID?: string;
  readonly VITE_HEALTHKIT_BRIDGE_TOKEN?: string;
  /** 路线二 Home Twin 前端地址；本地开发默认 http://localhost:5174。 */
  readonly VITE_HOME_TWIN_URL?: string;
  readonly VITE_AGENT_LLM_ENDPOINT?: string;
  /**
   * 真实视觉模型服务端代理地址。
   * 该 endpoint 必须由我们自己或可信任方运维；不应把任何供应商 API Key 写进浏览器环境变量。
   * 例如：
   *   VITE_HEALTH_VISION_ENDPOINT=/api/health/image-parse
   */
  readonly VITE_HEALTH_VISION_ENDPOINT?: string;
  /**
   * 理解层 LLM 语义仲裁（OpenAI 兼容 /chat/completions 端点）。
   * Demo 阶段 key 通过 .env 注入浏览器（仅限一次性/免费 key）；
   * 正式部署应换成服务端代理，见 README「理解层 LLM 语义仲裁」。
   */
  readonly VITE_UNDERSTANDING_LLM_BASE_URL?: string;
  readonly VITE_UNDERSTANDING_LLM_API_KEY?: string;
  readonly VITE_UNDERSTANDING_LLM_MODEL?: string;
  readonly VITE_UNDERSTANDING_LLM_TIMEOUT_MS?: string;
  /** 自建 PeerJS 信令服务器地址（wss://host:port/path），不配置则用官方公共信令。 */
  readonly VITE_PEER_SIGNALING_URL?: string;
  /** 自定义 ICE 服务器列表（JSON 数组，如 [{"urls":"turn:...","username":"...","credential":"..."}]）。 */
  readonly VITE_PEER_ICE_SERVERS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
