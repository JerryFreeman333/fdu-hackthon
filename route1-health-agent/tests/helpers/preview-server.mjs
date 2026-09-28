/**
 * 浏览器黑盒共用辅助：启动 vite preview 并等端口真正出 HTTP 才返回。
 *
 * 不解析 vite 的启动 banner：CI 终端（非 TTY）下 ANSI 分色码会把 "Local" 与 ":"
 * 隔开（如 `\x1b[1mLocal\x1b[22m:`），banner 文本匹配永远失败——这是 route1 CI
 * 在 GitHub Actions 上连红多轮的根因。就绪判定一律以端口轮询为准。
 */
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HELPER_DIR = dirname(fileURLToPath(import.meta.url));
export const ROUTE1_ROOT = resolve(HELPER_DIR, '..', '..');
const VITE_CLI = resolve(ROUTE1_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

/**
 * 启动 vite preview（--strictPort），轮询 `http://127.0.0.1:<port>/` 直到出 HTTP。
 * 返回 { stop } 句柄；进程提前退出（非 0）或超时抛错，超时时会顺手停掉进程。
 */
export async function startPreview({ port, prefix = '[preview]', timeoutMs = 60000 } = {}) {
  if (!port) throw new Error('startPreview 需要 port');
  const serverProcess = spawn(process.execPath, [VITE_CLI, 'preview', '--port', String(port), '--strictPort'], {
    cwd: ROUTE1_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const echo = (chunk) => process.stdout.write(`${prefix} ${chunk}`);
  serverProcess.stdout.on('data', echo);
  serverProcess.stderr.on('data', echo);
  let exited = false;
  let exitCode = null;
  serverProcess.on('exit', (code) => {
    exited = true;
    exitCode = code;
  });
  const stop = () => {
    try {
      serverProcess.kill('SIGTERM');
    } catch {}
  };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited && exitCode !== 0) {
      throw new Error(`vite preview 提前退出（退出码 ${exitCode}）`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      if (res.ok) return { stop };
    } catch {
      // 端口未就绪，继续轮询
    }
    await wait(400);
  }
  stop();
  throw new Error(`vite preview 启动超时（${timeoutMs}ms 内端口未就绪）`);
}
