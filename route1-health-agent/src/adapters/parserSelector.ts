/**
 * ParserSelector：根据环境变量自动选择合适的 ImageHealthParser。
 *
 * 优先级：
 *   1. VITE_HEALTH_VISION_ENDPOINT 设置且非空 → HttpVisionProvider → RealImageHealthParser
 *   2. 否则（开发/演示/无后端） → DemoImageHealthParser（保留为离线 fallback）
 *
 * 调用方只依赖返回的 ImageHealthParser 接口，不知道底层走真实视觉还是 Demo。
 *
 * 注意：在测试构建（CommonJS）环境下，import.meta 不可用；
 * 此时通过 process.env.VITE_HEALTH_VISION_ENDPOINT 注入（测试本身通过
 * endpointOverride 直接绕过）。
 */
import type { ImageHealthParser } from './ImageHealthParser';
import { DemoImageHealthParser } from './DemoImageHealthParser';
import { HttpVisionProvider } from './HttpVisionProvider';
import { RealImageHealthParser } from './RealImageHealthParser';

export interface SelectImageParserOptions {
  /** 注入测试用的 provider，便于单测覆盖 Real parser 全部分支。 */
  provider?: import('./ImageHealthParser').HealthVisionProvider;
  /** 强制使用 Demo parser（用于旧版 phase1 测试回归）。 */
  forceDemo?: boolean;
  /** 注入 endpoint，覆盖 import.meta.env / process.env。 */
  endpointOverride?: string;
}

export interface SelectedImageParser {
  parser: ImageHealthParser;
  mode: 'real-http' | 'demo';
}

function readEndpointFromEnv(): string | undefined {
  // Vite 在浏览器侧把 import.meta.env.VITE_* 注入为静态字符串。
  // 测试在 CommonJS 下编译，所以这里通过 globalThis 上的 vite 环境变量兜底读取；
  // 如果浏览器代码已经经过 Vite 编译，import.meta.env 会被内联为字面量，不需要这段代码运行。
  const globalAny = globalThis as { __VITE_HEALTH_VISION_ENDPOINT__?: string };
  if (typeof globalAny.__VITE_HEALTH_VISION_ENDPOINT__ === 'string') {
    return globalAny.__VITE_HEALTH_VISION_ENDPOINT__;
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env.VITE_HEALTH_VISION_ENDPOINT;
  }
  return undefined;
}

export function selectImageParser(options: SelectImageParserOptions = {}): SelectedImageParser {
  if (options.forceDemo) {
    return { parser: new DemoImageHealthParser(), mode: 'demo' };
  }
  if (options.provider) {
    return { parser: new RealImageHealthParser(options.provider), mode: 'real-http' };
  }
  const envEndpoint = options.endpointOverride ?? readEndpointFromEnv();
  if (envEndpoint && typeof envEndpoint === 'string' && envEndpoint.trim()) {
    const provider = new HttpVisionProvider({ endpoint: envEndpoint.trim() });
    return { parser: new RealImageHealthParser(provider), mode: 'real-http' };
  }
  return { parser: new DemoImageHealthParser(), mode: 'demo' };
}
