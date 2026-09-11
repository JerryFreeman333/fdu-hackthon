/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEVICE_MODE?: 'demo' | 'healthkit';
  readonly VITE_HEALTHKIT_ENDPOINT?: string;
  readonly VITE_HEALTHKIT_USER_ID?: string;
  readonly VITE_HEALTHKIT_BRIDGE_TOKEN?: string;
  readonly VITE_HEALTHKIT_USER_ID?: string;
  readonly VITE_HEALTH_VISION_MODE?: 'demo' | 'real';
  readonly VITE_HEALTH_VISION_ENDPOINT?: string;
  readonly VITE_AGENT_MODE?: 'rule' | 'llm';
  readonly VITE_AGENT_LLM_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
