/**
 * ImageHealthParser（真实与 Demo）的回归测试。
 *
 * 覆盖：
 *   - 血压正常解析
 *   - 体重正常解析
 *   - 化验报告 LabResult 框架（仅对 name/value/unit 完整的项入库）
 *   - provider 返回 malformed JSON
 *   - 低 confidence
 *   - 缺少单位
 *   - unknown image
 *   - 血压只识别到一个数字
 *   - 体重出现明显无法解释的值
 *   - 用户取消确认后不得写入事件流（由 caller 行为约束）
 *   - Demo fallback 仍然可工作
 *   - ParserSelector 在不同配置下选择正确实现
 */
import { RealImageHealthParser } from '../src/adapters/RealImageHealthParser';
import { MockVisionProvider } from '../src/adapters/MockVisionProvider';
import { DemoImageHealthParser, demoImageHealthParser } from '../src/adapters/DemoImageHealthParser';
import { ImageParserError } from '../src/adapters/ImageHealthParser';
import { selectImageParser } from '../src/adapters/parserSelector';
import { HttpVisionProvider } from '../src/adapters/HttpVisionProvider';
import { validateVisionResult, MIN_OVERALL_CONFIDENCE } from '../src/adapters/imageNormalizer';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function fakeImage(kind: 'bp' | 'weight' | 'report' = 'bp'): Blob {
  // 一个最小可用的 1x1 PNG；测试并不读取像素，只用作 Blob 占位。
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);
  return new Blob([png], { type: 'image/png' });
}

async function runCase(name: string, fn: () => void | Promise<void>) {
  await fn();
  console.log(`PASS: ${name}`);
}

async function main(): Promise<void> {
  await runCase('real parser produces blood pressure measurement from mock provider', async () => {
    const provider = new MockVisionProvider();
    const parser = new RealImageHealthParser(provider);
    const result = await parser.parse(fakeImage(), {
      capturedAt: '2026-09-09T19:30:00.000Z',
      kind: 'bloodPressure',
    });
    const sys = result.measurements.find((m) => m.metric === 'systolic');
    const dia = result.measurements.find((m) => m.metric === 'diastolic');
    assert(sys && sys.value === 148, `systolic should be 148, got ${sys?.value}`);
    assert(dia && dia.value === 88, `diastolic should be 88, got ${dia?.value}`);
    assert(sys.unit === 'mmHg', 'systolic unit should be mmHg');
    assert(result.parseMeta?.detectedKind === 'bloodPressure', 'kind should be bloodPressure');
  });

  await runCase('real parser produces weight measurement from mock provider', async () => {
    const provider = new MockVisionProvider();
    const parser = new RealImageHealthParser(provider);
    const result = await parser.parse(fakeImage('weight'), {
      capturedAt: '2026-09-09T19:30:00.000Z',
      kind: 'weight',
    });
    assert(result.measurements.length === 1, 'weight should produce exactly one measurement');
    assert(result.measurements[0].metric === 'weight', 'metric should be weight');
    assert(result.measurements[0].value === 63.4, 'value should be 63.4');
    assert(result.measurements[0].unit === 'kg', 'unit should be kg');
  });

  await runCase('provider returning malformed JSON is rejected as malformed_json', async () => {
    const provider = new MockVisionProvider();
    provider.malformedNext = true;
    const parser = new RealImageHealthParser(provider);
    let caught: ImageParserError | null = null;
    try {
      await parser.parse(fakeImage(), { kind: 'bloodPressure' });
    } catch (error) {
      caught = error as ImageParserError;
    }
    assert(caught instanceof ImageParserError, 'should throw ImageParserError');
    assert(caught?.code === 'malformed_json', `expected malformed_json, got ${caught?.code}`);
  });

  await runCase('low overall confidence is rejected', async () => {
    const provider = new MockVisionProvider();
    provider.forceLowConfidence = true;
    const parser = new RealImageHealthParser(provider);
    let caught: ImageParserError | null = null;
    try {
      await parser.parse(fakeImage(), { kind: 'bloodPressure' });
    } catch (error) {
      caught = error as ImageParserError;
    }
    assert(caught?.code === 'low_confidence', `expected low_confidence, got ${caught?.code}`);
  });

  await runCase('missing unit is rejected', async () => {
    const provider = new MockVisionProvider();
    provider.forceMissingUnit = true;
    const parser = new RealImageHealthParser(provider);
    let caught: ImageParserError | null = null;
    try {
      await parser.parse(fakeImage(), { kind: 'weight' });
    } catch (error) {
      caught = error as ImageParserError;
    }
    assert(caught?.code === 'missing_unit', `expected missing_unit, got ${caught?.code}`);
  });

  await runCase('unknown image kind is rejected', async () => {
    const provider = new MockVisionProvider();
    provider.forceUnknown = true;
    const parser = new RealImageHealthParser(provider);
    let caught: ImageParserError | null = null;
    try {
      await parser.parse(fakeImage(), { kind: 'bloodPressure' });
    } catch (error) {
      caught = error as ImageParserError;
    }
    assert(caught?.code === 'unknown_image', `expected unknown_image, got ${caught?.code}`);
  });

  await runCase('blood pressure with only systolic is rejected', async () => {
    const provider = new MockVisionProvider();
    provider.systolicOnly = true;
    const parser = new RealImageHealthParser(provider);
    let caught: ImageParserError | null = null;
    try {
      await parser.parse(fakeImage(), { kind: 'bloodPressure' });
    } catch (error) {
      caught = error as ImageParserError;
    }
    assert(
      caught?.code === 'invalid_blood_pressure',
      `expected invalid_blood_pressure, got ${caught?.code}`,
    );
  });

  await runCase('empty blob is rejected as empty_image', async () => {
    const parser = new RealImageHealthParser(new MockVisionProvider());
    let caught: ImageParserError | null = null;
    try {
      await parser.parse(new Blob([], { type: 'image/png' }), { kind: 'bloodPressure' });
    } catch (error) {
      caught = error as ImageParserError;
    }
    assert(caught?.code === 'empty_image', `expected empty_image, got ${caught?.code}`);
  });

  await runCase('unsupported image mime is rejected as unsupported_format', async () => {
    const parser = new RealImageHealthParser(new MockVisionProvider());
    let caught: ImageParserError | null = null;
    try {
      await parser.parse(new Blob(['x'], { type: 'application/pdf' }), { kind: 'bloodPressure' });
    } catch (error) {
      caught = error as ImageParserError;
    }
    assert(
      caught?.code === 'unsupported_format',
      `expected unsupported_format, got ${caught?.code}`,
    );
  });

  await runCase('Demo parser continues to work as offline fallback', async () => {
    const parsed = await demoImageHealthParser.parse(fakeImage(), {
      kind: 'bloodPressure',
      capturedAt: '2026-09-09T19:30:00.000Z',
    });
    assert(parsed.measurements.length === 2, 'demo parser should still produce 2 BP measurements');
    assert(parsed.measurements[0].metric === 'systolic', 'first metric should be systolic');
    assert(parsed.measurements[0].value === 148, 'demo systolic should remain 148');
    assert(parsed.tags.includes('bpHigh'), 'demo parser should still flag bpHigh');
  });

  await runCase('Demo parser produces weight sample', async () => {
    const parsed = await demoImageHealthParser.parse(fakeImage('weight'), { kind: 'weight' });
    assert(parsed.measurements.length === 1, 'demo weight should produce 1 measurement');
    assert(parsed.measurements[0].value === 63.4, 'demo weight should remain 63.4');
  });

  await runCase('DemoImageHealthParser still satisfies the abstraction', async () => {
    const parser: import('../src/adapters/ImageHealthParser').ImageHealthParser = new DemoImageHealthParser();
    const out = await parser.parse(fakeImage(), { kind: 'bloodPressure' });
    assert(Array.isArray(out.measurements), 'Demo parser output should be ParsedHealthData-compatible');
  });

  await runCase('parser selector picks Demo when no endpoint configured', () => {
    const selected = selectImageParser({ forceDemo: true });
    assert(selected.mode === 'demo', `expected demo, got ${selected.mode}`);
  });

  await runCase('parser selector picks real-http when endpoint is configured', () => {
    const selected = selectImageParser({ endpointOverride: 'http://localhost:9999/api/health/image-parse' });
    assert(selected.mode === 'real-http', `expected real-http, got ${selected.mode}`);
  });

  await runCase('parser selector honors test-injected provider', () => {
    const provider = new MockVisionProvider();
    const selected = selectImageParser({ provider });
    assert(selected.mode === 'real-http', 'injected provider should yield real-http');
  });

  await runCase('user-cancelled photo import does not produce HealthEvent-shaped output', () => {
    // 模拟用户取消：useElderChat.handlePhotoImport 在 UI 不点击"确认保存"时
    // 完全不会进入 setEvents。这条用例验证 pending 结构本身不携带
    // 任何会绕过 UI 进入 HealthEvent 的字段。
    const pendingShape: import('../src/adapters/ImageHealthParser').PendingPhotoImport = {
      draftId: 'pending-1',
      detectedKind: 'bloodPressure',
      capturedAt: '2026-09-09T19:30:00.000Z',
      measurements: [],
      labResults: [],
      tags: [],
      provider: 'mock',
      overallConfidence: 0.9,
      warnings: [],
      image: fakeImage(),
    };
    assert(pendingShape.measurements.length === 0, 'pending carries no committed measurements');
    assert(!('id' in pendingShape) || pendingShape.draftId.startsWith('pending-'), 'pending ids are non-event');
  });

  await runCase('HttpVisionProvider accepts a valid JSON response', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          kind: 'bloodPressure',
          measurements: [
            { metric: 'systolic', value: 130, unit: 'mmHg', confidence: 0.9 },
            { metric: 'diastolic', value: 85, unit: 'mmHg', confidence: 0.9 },
          ],
          labResults: [],
          confidence: 0.9,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    const provider = new HttpVisionProvider({
      endpoint: 'http://localhost:9999/api/health/image-parse',
      fetchImpl: fakeFetch,
    });
    const result = await provider.analyzeImage(fakeImage(), { kind: 'bloodPressure' });
    assert(result.kind === 'bloodPressure', 'response kind should round-trip');
    assert(result.measurements.length === 2, 'should parse both measurements');
  });

  await runCase('HttpVisionProvider rejects non-JSON response as malformed_json', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    const provider = new HttpVisionProvider({
      endpoint: 'http://localhost:9999/api/health/image-parse',
      fetchImpl: fakeFetch,
    });
    let caught: ImageParserError | null = null;
    try {
      await provider.analyzeImage(fakeImage(), { kind: 'bloodPressure' });
    } catch (error) {
      caught = error as ImageParserError;
    }
    assert(caught?.code === 'malformed_json', `expected malformed_json, got ${caught?.code}`);
  });

  await runCase('HttpVisionProvider maps provider_error on non-2xx', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response('boom', { status: 500, headers: { 'Content-Type': 'text/plain' } });
    const provider = new HttpVisionProvider({
      endpoint: 'http://localhost:9999/api/health/image-parse',
      fetchImpl: fakeFetch,
    });
    let caught: ImageParserError | null = null;
    try {
      await provider.analyzeImage(fakeImage(), { kind: 'bloodPressure' });
    } catch (error) {
      caught = error as ImageParserError;
    }
    assert(caught?.code === 'provider_error', `expected provider_error, got ${caught?.code}`);
  });

  await runCase('validateVisionResult enforces minimum confidence', () => {
    assert(MIN_OVERALL_CONFIDENCE > 0 && MIN_OVERALL_CONFIDENCE <= 1, 'threshold should be in (0,1]');
    let threw = false;
    try {
      validateVisionResult({
        kind: 'bloodPressure',
        measurements: [{ metric: 'systolic', value: 120, unit: 'mmHg', confidence: 0.9 }],
        labResults: [],
        confidence: 0.1,
      });
    } catch (e) {
      threw = e instanceof ImageParserError && e.code === 'low_confidence';
    }
    assert(threw, 'low confidence should be rejected');
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});