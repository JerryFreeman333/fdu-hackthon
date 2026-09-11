/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HOME_MODE?: 'demo' | 'real';
  readonly VITE_ROUTE2_API_URL?: string;
}
