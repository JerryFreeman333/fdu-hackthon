/**
 * RealImageHealthParser：通过 Vision Provider 真实读取图片。
 *
 * 链路：
 *   1. 客户端调用 parse(image, context)
 *   2. validateImageInput 拦掉空图/格式异常
 *   3. provider.analyzeImage(image, context) 调用视觉后端
 *   4. buildParsedHealthData 把严格 JSON 校验/归一化为 ParsedHealthData
 *   5. 调用方拿到结果 → 走"用户确认 → HealthEvent"流程
 *
 * 不向 HealthEvent 直接写入：UI 必须拿到结果后让用户确认。
 */
import type {
  HealthVisionProvider,
  ImageHealthParser,
  ImageParseContext,
  ParsedHealthData,
} from './ImageHealthParser';
import { ImageParserError } from './ImageHealthParser';
import { buildParsedHealthData, validateImageInput } from './imageNormalizer';

export class RealImageHealthParser implements ImageHealthParser {
  constructor(private readonly provider: HealthVisionProvider) {}

  async parse(image: Blob, context?: ImageParseContext): Promise<ParsedHealthData> {
    validateImageInput(image);
    const visionContext = {
      ...(context ?? {}),
      ...(context?.capturedAt ? { capturedAt: context.capturedAt } : { capturedAt: new Date().toISOString() }),
    };
    let visionResult;
    try {
      visionResult = await this.provider.analyzeImage(image, visionContext);
    } catch (error) {
      if (error instanceof ImageParserError) throw error;
      if (error instanceof SyntaxError) {
        throw new ImageParserError('malformed_json', error.message);
      }
      throw new ImageParserError('provider_error', (error as Error).message);
    }
    return buildParsedHealthData(visionResult, context ?? {}, this.provider.name);
  }
}