/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AGENT_LLM_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
