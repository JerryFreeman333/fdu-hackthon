# 安康 Agent（A1 路线一：先认识老人）

> 不是把老人变成“健康数据”，而是让 Agent 逐步认识一个老人平时是什么状态，只在出现有意义的变化时帮助他，并把真正需要家属介入的事情说明白。

这是 fdu-hackthon A1 的**第一阶段 MVP**。产品路线不是停在健康聊天，而是：

```text
Phase 1  Person Twin
    ↓
Phase 2  Home Twin（后续接入）
    ↓
Phase 3  Person × Home 个性化居家风险（后续接入）
    ↓
Phase 4  Agent 解释 + 帮助行动 + 家庭协同
```

最终要回答的不是“老人健康吗”或者“家里安全吗”，而是“这个家，对现在这个老人是否安全”。当前代码集中完成 Phase 1，同时为后续 Home Twin 保留稳定的数据、Agent 和硬件边界。

## 当前产品体验

### 老人端

第一次进入先选择“我是老人”。首页围绕“帮我”组织，而不是让老人学习复杂功能：

- 直接聊天，说出“不舒服、走路变慢、睡不好、药忘了”等自然表达；
- 支持浏览器原生中文语音输入，识别后直接进入原有对话链路；
- 对“我昨晚起夜三四次”“今天走了六千步”等表达提取结构化数值，并写入 `HealthMeasurement(source=chat)`；
- 看到“今天要做的事”，支持 `pending → in_progress → completed`；
- 有变化时给出简单、行动导向的提醒；
- 可以明确表达“这个不要告诉孩子”“这个不要记录”；
- 普通状态尽量安静，复杂指标和详细趋势收进可选的状态页。

### 家属端

第一次进入选择“我是家属”。首页优先回答：

> 今天总体正常，还是今天有一件事值得关注？

家属只看到需要介入的内容；必要时再查看详细变化和周报。每条家属通知带有“为什么现在告诉您”和建议行动，而不是暴露原始风险分数。

当前家庭绑定与联系老人均为**本地 Demo 模拟**：老人端可生成邀请码，家属端输入邀请码后在本地完成校验和绑定。真实产品需要后端账号体系、二维码/手机号验证及跨设备同步。

### 单设备双角色说明

当前 Demo 使用同一个浏览器的 `localStorage` 保存演示状态，老人端和家属端通过“切换身份”模拟两个角色。这意味着它不是跨设备同步方案：两台手机分别打开时不会共享这份浏览器本地数据。跨设备同步属于下一阶段的远程 Store / BaaS 工作，不应在当前版本中冒充已经完成。

## Person Twin

`engine/personTwin.ts` 描述与后续居家安全有关的状态，而不是医院病历或疾病诊断。当前包括：

- 活动量趋势；
- 行动/步行趋势；
- 睡眠趋势；
- 夜间活动趋势；
- 最近主诉；
- 是否使用拐杖；
- 夜间视力状态；
- 认知状态；
- 当前与居家安全相关的变化。

Person Twin 的目的，是让后续 `Person × Home` 风险模型可以直接使用“现在这个老人是什么状态”，而不是重新从聊天或设备原始数据里猜一次。

## 数据架构

所有输入统一进入健康事件流：

```text
设备 Adapter / 图像解析器 / 聊天 / 手动导入
                 ↓
            HealthEvent[]
                 ↓
         materialize / normalize
                 ↓
 Measurement / Observation / LabResult / DayRecord
                 ↓
      Baseline → Signal → Rule → Fusion → Safety
                 ↓
              Finding[]
                 ↓
   Person Twin / Agent Context / Family / Tasks / Report
```

`HealthEvent[]` 是运行时事实来源；`DayRecord` 是由 measurement 派生的 UI/Detection 视图。

## 对话理解与结构化数值

`engine/agent.ts` 与 `engine/extract.ts` 分工明确：

```text
自然语言
  ↓
Intent rules        → SymptomTag
  ↓
Numeric extractor  → HealthMeasurement
  ↓
HealthEvent[]
  ↓
Baseline / Detection / Person Twin
```

当前刻意只覆盖 Phase 1 最有价值的两个数值场景：

- `nightWakes`：如“昨晚起夜三四次”“夜里 3 到 4 次”；
- `steps`：如“今天走了六千步”“7200 步”。

中文数字、阿拉伯数字和常见量词均支持；区间按中点进入结构化值，原始命中文本保存在 `metadata.sourceText` 中。

因此“老人说三四次”不再只是打 `poorSleep` 标签，而会真正进入夜间醒来指标，并可以参与后续个人基线与趋势计算。

## Agent 与 LlmAdapter

`engine/agent.ts` 现在真正通过 `LlmAdapter.complete()` 生成回复，安全等级、Finding 和 Detection 仍由规则引擎掌控，LLM 只负责理解上下文后的语言表达，不负责自行改变安全分级。

默认 Demo 使用离线 `ruleBasedAdapter`，因此无网络也能稳定演示。真实 LLM 接入通过 `VITE_AGENT_LLM_ENDPOINT` 指向**服务端代理**完成，API key 不应写进浏览器环境。该 Endpoint 可以在服务端对接 GPT、Claude 或其他模型；客户端不会直接保存厂商密钥。

即使配置真实 LLM，发送给外部模型的 Agent Context 也会先过滤 `visibility=private` 的观察，避免把老人明确标记为私密的信息直接交给第三方模型。

## “有理由地追问”

`engine/questions.ts` 单独定义追问策略：只有在上下文里存在明确理由时才追问，例如：

```text
活动量连续下降 + 老人说“最近腿没劲”
→ 追问“这种变化大概是最近几天才开始的吗？”
```

不是每天固定问同一套问题，也不让聊天退化成问卷。

## 隐私与家属协同

老人可以主动控制信息是否进入家属协同：

```text
private      → 只保留给老人自己的上下文
family_ok    → 在当前授权下可用于必要的家属协同
no_record   → 该次对话不写入持久健康事件/家属视图
```

家属通知会经过 `familySharing` 和 `familyEligible` 双重过滤；家属详细变化与周报进一步要求 `familySharing === granted`。这样“系统知道”与“家属应该知道”不是同一件事。

## 行动闭环

`engine/tasks.ts` 提供第一阶段的最小行动状态机：

```text
发现变化
  ↓
生成任务
  ↓
pending
  ↓
in_progress
  ↓
completed
```

只有可行动 Finding 或明确事件才生成任务，稳定状态不会自动生成每日噪声。

## 周报

周报保留，但定位已经从“健康数据大盘”改为“这一周有什么变了”。当前按本周与此前稳定窗口比较；家属版周报不会包含 `private` Observation。周报为**本地 Demo 即时生成**，不虚构真实定时推送。

## 硬件 / OCR 边界

当前**不接真实硬件、不接真实 OCR/Vision、不接云端数据库**，这是当前阶段的主动范围控制，不是架构缺失。

硬件入口仍保留：

```ts
interface DeviceAdapter {
  readonly source: DataSource;
  getMeasurements(userId: string, from: string, to: string): Promise<HealthMeasurement[]>;
}
```

真实 HealthKit、Health Connect、蓝牙设备或厂商 SDK 后续只需要实现 Adapter；Detection、Person Twin、Agent 不应该依赖具体硬件。

图像识别同样保留 `ImageHealthParser` 接口；当前不把预置样张冒充成真实 OCR。

## 医疗安全边界

本项目做的是**状态变化发现、隐私控制和安全分流**，不做疾病诊断，不根据单个异常读数直接下疾病结论。真实产品上线前仍需要临床专家对规则、阈值、误报/漏报和紧急处置文本进行验证。

## 回归测试

`tests/detection.test.ts` 当前覆盖：

- 多信号变化；
- 稳定 Finding；
- 稀疏数据沉默；
- 单指标 `watch`；
- 极高血压安全分流；
- 胸痛 / 跌倒等危险症状；
- 三类健康输入统一事件流；
- Person Twin Context；
- 隐私过滤；
- 中文数值抽取；
- Agent Adapter 与有理由追问；
- 周报私密信息隔离；
- `pending → completed` 任务状态机。

## 运行

```bash
cd route1-health-agent
npm install
npm run dev
npm test
```

### 可选：接入真实 LLM 服务端

```bash
VITE_AGENT_LLM_ENDPOINT=/api/agent/chat npm run dev
```

该变量只配置代理地址，不放 OpenAI / Anthropic API key。代理应返回：

```json
{
  "text": "给老人的最终回复",
  "tags": ["fatigue"]
}
```
