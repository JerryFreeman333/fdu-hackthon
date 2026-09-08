import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { deepseekPlugin } from './server/deepseek';

export default defineConfig(({ mode }) => ({
  plugins: [react(), deepseekPlugin(loadEnv(mode, process.cwd(), ''))],
}));
