# Health Image Parser MVP（Phase 2 真实拍照录入）

> 路线一 Phase 2 的第一步：把 `DemoImageHealthParser` 升级为真正能读取用户上传图片的 `RealImageHealthParser`，并保留 Demo 作为兜底。

## 1. 设计目标

- 真实图片（血压计 / 体重秤 / 体检报告）→ 视觉/OCR → **严格结构化 JSON** → 校验归一化 → **用户确认** → 写入现有 `HealthEvent` 流水线
- 不让 Detection、Person Twin、Agent 直接依赖任何具体视觉模型
- 不在浏览器端保存任何供应商 API Key（OpenAI / Claude / Gemini …）
- 失败路径**绝不静默写入**：空图、格式不支持、识别失败、数值缺失、单位异常、confidence 过低、模型返回非法 JSON、血压只识别到收缩压等都会主动抛错

## 2. 架构

```text
File / Camera
   ↓
RealImageHealthParser        ← src/adapters/RealImageHealthParser.ts
   ↓
HealthVisionProvider (可替换) ← src/adapters/{HttpVisionProvider,MockVisionProvider,DemoImageHealthParser}.ts
   ↓
严格 JSON: HealthVisionResult
   ↓
imageNormalizer.validate + buildParsedHealthData
   ↓
PendingPhotoImport (UI 预览)   ← src/adapters/ImageHealthParser.ts
   ↓
用户点击"确认保存"              ← src/components/ElderHome.tsx (PhotoReviewPanel)
   ↓
commitPendingPhotoImport()
   ↓
HealthMeasurement / LabResult
   ↓
appendHealthEvents → 现有 HealthEvent pipeline
   ↓
Baseline / Detection / Person Twin / Family
```

`DemoImageHealthParser` 继续保留：未配置 `VITE_HEALTH_VISION_ENDPOINT` 时，`parserSelector` 自动切回它，作为离线/演示 fallback。

## 3. 模块清单

| 文件 | 角色 |
| --- | --- |
| `src/adapters/ImageHealthParser.ts` | 公共接口：`ImageHealthParser`、`HealthVisionProvider`、`PendingPhotoImport`、`HealthVisionResult`、`ImageParserError`、白名单 `ALLOWED_METRIC_KEYS` |
| `src/adapters/RealImageHealthParser.ts` | 真实实现：调用 Provider → 严格 JSON 校验 → 返回 `ParsedHealthData` |
| `src/adapters/HttpVisionProvider.ts` | 默认 Provider：调用服务端代理 `POST {VITE_HEALTH_VISION_ENDPOINT}`，遵守 multipart/form-data 协议 |
| `src/adapters/MockVisionProvider.ts` | 测试用 Provider：可注入异常分支（malformed / low_confidence / unknown / missing_unit / systolic_only） |
| `src/adapters/DemoImageHealthParser.ts` | 离线 fallback（保留旧 Demo 行为，固定示例数据） |
| `src/adapters/imageNormalizer.ts` | Provider 输出 → `ParsedHealthData` 的校验与归一化（单位、范围、血压完整性、confidence 阈值） |
| `src/adapters/parserSelector.ts` | 根据 `VITE_HEALTH_VISION_ENDPOINT` 自动选 Real 或 Demo；测试可注入 provider 或 endpoint |
| `src/hooks/useElderChat.ts` | `handlePhotoImport` 只返回 `PendingPhotoImport`（不写事件）；`commitPendingPhotoImport` 才是真正写入 |
| `src/components/ElderHome.tsx` | 照片识别 + 预览 + 确认面板（PhotoReviewPanel） |
| `src/styles.css` | 适老化样式：`.photo-review`、`.review-summary`、`.review-edit`、`.review-actions` |
| `src/vite-env.d.ts` | 新增 `VITE_HEALTH_VISION_ENDPOINT` |
| `tests/image-health-parser.test.ts` | 20 个子测试，覆盖所有错误分支 |

## 4. Provider 接口与请求协议

```ts
interface HealthVisionProvider {
  readonly name: string;
  analyzeImage(image: Blob, context?: VisionParseContext): Promise<HealthVisionResult>;
}
```

`HttpVisionProvider` 默认协议（服务端代理按此实现即可）：

```http
POST {VITE_HEALTH_VISION_ENDPOINT}
Content-Type: multipart/form-data

image=<binary>
kind=bloodPressure | weight | report
meta={"capturedAt":"...","imageMeta":"..."}
```

返回必须是严格 JSON：

```json
{
  "kind": "bloodPressure",
  "measurements": [
    { "metric": "systolic",  "value": 148, "unit": "mmHg", "confidence": 0.95 },
    { "metric": "diastolic", "value": 88,  "unit": "mmHg", "confidence": 0.95 }
  ],
  "labResults": [],
  "rawText": "SYS 148\nDIA 88",
  "confidence": 0.93
}
```

- `metric` 仅允许以下白名单：`weight | systolic | diastolic | restingHr | spo2 | bloodGlucose`（未来扩展时显式加入白名单）
- `unit` 必须非空且与 `metric` 的单位集合兼容
- 缺字段 / 类型不对 / 非 JSON 都会抛 `ImageParserError('malformed_json' | 'provider_error')`

## 5. 错误码 → UI 提示

| code | 含义 | UI 文案 |
| --- | --- | --- |
| `empty_image` | 图片为空 | 这张图片是空的，请重新拍一张。 |
| `unsupported_format` | 格式不支持 | 请换成 JPG/PNG/WebP 重试。 |
| `image_unreadable` | 图片损坏 | 这张图片似乎损坏了，请重新拍一张。 |
| `missing_values` | 数值缺失 | 请重新拍或直接告诉我数字。 |
| `missing_unit` | 缺少单位 | 请重拍或在预览里手动补充。 |
| `low_confidence` | confidence 过低 | 请再拍一张更清楚的。 |
| `malformed_json` | provider 返回非法 JSON | 识别服务返回的数据格式异常，请稍后再试。 |
| `unknown_image` | 无法识别为已知类型 | 请重新拍摄。 |
| `invalid_blood_pressure` | 血压不完整/越界 | 请再拍一张或直接告诉我数字。 |
| `invalid_weight` | 体重越界 | 请重拍或直接告诉我数字。 |
| `provider_error` | 网络/HTTP 失败 | 默认降级提示 |
| `aborted` | 用户取消 | 已取消这次识别。 |

## 6. 隐私与医疗边界

- **不做疾病诊断**。识别模块只输出数值/文本，不输出医学结论。
- **图片不会永久保存**。`PendingPhotoImport` 只把 Blob 保留在 React 状态里用于"重新识别"；不写入 localStorage 或服务端。
- **provider 必须走服务端代理**。`VITE_HEALTH_VISION_ENDPOINT` 配置的是**代理地址**，不能写 `sk-...` 这类供应商 key。
- **不输出图片字节 / base64 / 健康数据到日志**。`HttpVisionProvider` 只打印错误 message，不打印 response body。
- **风险判定继续走现有 detection / safety engine**。本模块不参与严重度分类。

## 7. 配置 Vision Backend

### 7.1 不配置（演示 / 离线 fallback）

不设置 `VITE_HEALTH_VISION_ENDPOINT` 时，`parserSelector` 自动选 `DemoImageHealthParser`：

```bash
cd route1-health-agent
npm run dev
```

UI 顶部会显示 `当前走演示数据 fallback`。

### 7.2 配置真实后端代理

```bash
VITE_HEALTH_VISION_ENDPOINT=/api/health/image-parse npm run dev
```

> 这个 endpoint 由你们的服务端实现。**不要**把 OpenAI/Claude/Gemini Key 直接写进前端环境变量。
> 推荐做法：服务端接收 multipart/form-data → 内部调用供应商 SDK → 用本文档第 4 节定义的 JSON 协议返回结果给前端。

代理实现参考（任何语言）：

```python
# 示例：FastAPI / Python
from fastapi import FastAPI, UploadFile, Form
from fastapi.responses import JSONResponse
import os

@router.post("/api/health/image-parse")
async def parse_image(image: UploadFile, kind: str = Form(...), meta: str = Form(...)):
    # 在这里调用 OpenAI / Anthropic / 自托管视觉模型
    # 注意：prompt 必须要求"严格 JSON, 不要自然语言"
    #  返回值示例（与 §4 一致）
    return JSONResponse({
        "kind": kind,
        "measurements": [...],
        "labResults": [...],
        "rawText": "...",
        "confidence": 0.93
    })
```

服务端提示词应包含：
1. 输出格式必须严格 JSON，禁止自然语言
2. `metric` 仅限：`systolic / diastolic / restingHr / weight / spo2 / bloodGlucose`
3. `unit` 必须填写
5. `kind` 仅限 `bloodPressure / weight / report / unknown`，识别不出时填 `unknown` 而不是猜测
6. `confidence` 必须是 0~1 的小数

## 8. 现场演示步骤（完整闭环）

```bash
cd fdu-hackthon/route1-health-agent
npm install
npm run dev
# 浏览器打开 http://localhost:5173 ，选择"我是老人"
```

### Demo A：演示 fallback（无需后端）

1. 在「记录一下血压、体重或报告」卡片选择 **血压**
2. 点 **拍一张/选一张**，随便选一张图片（甚至空白）
4. UI 提示：演示示例 **血压 148/88 mmHg**
5. 点 **确认保存** → "已保存：收缩压 148 mmHg、舒张压 88 mmHg"
6. 在「查看我的状态」里能看到新写入的 `HealthMeasurement(source=photo)`

### Demo B：真实血压计照片（需启动后端代理）

1. 启动你们写的后端代理（监听 `/api/health/image-parse`）
2. 启动前端：
   ```bash
   VITE_HEALTH_VISION_ENDPOINT=/api/health/image-parse npm run dev
   ```
3. 拍照一张真实血压计屏幕
4. UI 弹出预览面板：
   ```
   请确认识别结果
   血压
   148 / 88 mmHg
   识别模式：http-proxy · 整体置信度 93%
   [手动修改识别结果 ▾]
   [确认保存] [重新识别] [取消]
   ```
5. 点 **确认保存** → 数据进入 `HealthMeasurement(source=photo, confidence=0.95)`
6. 现有 detection / Person Twin / FamilyDashboard 直接消费

### Demo C：体重秤照片

同 Demo B，把 kind 切到 **体重**。最终预览展示 **63.4 kg**。

## 9. 边界与未完成

- 体检报告：第一阶段只处理 name/value/unit/参考范围 明确的项；无法确认的项**绝不**猜测。
- 化验项结构化识别准确率依赖后端视觉模型本身，本模块只负责"读取 → 校验 → 用户确认 → 写库"。
- 当前**没有**内置 OCR / 视觉模型。需要真实使用时必须配套实现 §7.2 中的服务端代理。
- 多设备协议接入（HealthKit / Health Connect / 蓝牙血压计）仍走 `DeviceAdapter` 接口，与本模块无关。

## 10. 测试

```bash
cd route1-health-agent
npm test          # 包含 20 个新子测试 + 全部旧测试
npm run build     # 通过
```

新增 `tests/image-health-parser.test.ts` 覆盖：
- 血压 / 体重 / 化验报告正常解析
- `malformed_json` / `low_confidence` / `missing_unit` / `unknown_image` / `invalid_blood_pressure` / `empty_image` / `unsupported_format` / `provider_error` 错误分支
- 用户取消后无 HealthEvent 输出
- Demo fallback 仍可工作
- `parserSelector` 在 forceDemo / endpoint 配置 / 注入 provider 下的选择正确性
- `HttpVisionProvider` JSON 解析与非 2xx 错误映射

## 11. 修改清单

| 类型 | 文件 |
| --- | --- |
| 新增 | `src/adapters/RealImageHealthParser.ts` |
| 新增 | `src/adapters/HttpVisionProvider.ts` |
| 新增 | `src/adapters/MockVisionProvider.ts` |
| 新增 | `src/adapters/imageNormalizer.ts` |
| 新增 | `src/adapters/parserSelector.ts` |
| 新增 | `tests/image-health-parser.test.ts` |
| 新增 | `docs/health-image-parser.md`（本文档） |
| 扩展 | `src/adapters/ImageHealthParser.ts`（新增 Vision 接口、Pending 类型、错误码） |
| 扩展 | `src/adapters/DemoImageHealthParser.ts`（保留并补充语义注释） |
| 扩展 | `src/hooks/useElderChat.ts`（两步式拍照流） |
| 扩展 | `src/components/ElderHome.tsx`（确认面板 + 编辑） |
| 扩展 | `src/App.tsx`（注入 `commitPendingPhotoImport` 与 `imageParserMode`） |
| 扩展 | `src/styles.css`（确认面板适老化样式） |
| 扩展 | `src/vite-env.d.ts`（`VITE_HEALTH_VISION_ENDPOINT`） |
| 扩展 | `tsconfig.test.json`（把 `src/adapters`/`src/pipeline` 加入测试 include） |

**未触碰**：`engine/` 下所有 detection / baseline / personTwin / privacy / agent / report 等模块；`pipeline/events.ts` 的签名；`App.tsx` 中除拍照外的所有交互。