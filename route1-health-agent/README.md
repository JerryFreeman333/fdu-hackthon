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
- 看到“今天要做的事”，支持 `pending → in_progress → completed`；
- 有变化时给出简单、行动导向的提醒；
- 可以明确表达“这个不要告诉孩子”“这个不要记录”；
- 普通状态尽量安静，复杂指标和详细趋势收进可选的状态页。

### 家属端

第一次进入选择“我是家属”。首页优先回答：

> 今天总体正常，还是今天有一件事值得关注？

家属只看到需要介入的内容；必要时再查看详细变化和周报。每条家属通知带有“为什么现在告诉您”和建议行动，而不是暴露原始风险分数。

当前家庭绑定、联系老人均为**本地 Demo 模拟**，没有伪装成真实短信、电话或账号服务。

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

## Detection Engine

`engine/detect.ts` 只负责编排，规则拆分为：

- signal：把近期数据与个人基线比较；
- metric baseline：单指标变化默认保持 `watch`；
- contextual：把主诉和客观变化结合；
- fusion：多个不同维度同时变化才升级到 `alert`；
- safety：跌倒、突发神经系统异常、胸痛以及极高血压等进入安全分流。

Finding 保留 `ruleId`、`signalKeys`、`score`、evidence，并支持 `familyEligible`，方便解释、审计、测试和隐私过滤。分数只表示规则强度，不代表疾病概率。

## Agent 与“有理由地追问”

`engine/agent.ts` 负责把结构化状态重新变成老人听得懂的话。`engine/questions.ts` 单独定义追问策略：只有在上下文里存在明确理由时才追问，例如：

```text
活动量连续下降 + 老人说“最近腿没劲”
→ 追问“这种变化大概是最近几天才开始的吗？”
```

不是每天固定问同一套问题，也不让聊天退化成问卷。

当前 Agent 使用离线规则完成 Demo；`LlmAdapter` 保留接口，未来可替换为真实 LLM，不改变 Detection/Person Twin 的安全边界。

## 隐私与家属协同

老人可以主动控制信息是否进入家属协同：

```text
private      → 只保留给老人自己的上下文
family_ok    → 在当前授权下可用于必要的家属协同
no_record   → 该次对话不写入持久健康事件/家属视图
```

家属通知还会经过 `familySharing` 和 `familyEligible` 双重过滤。这样“系统知道”与“家属应该知道”不是同一件事。

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

Demo 里已经可以把健康变化转成“今天要做的事”，并记录完成状态。后续 Home Twin 接入后，同一任务模型可扩展到“移走地毯 → 补拍现场 → 重新分析”的 `发现 → 行动 → 验证` 闭环。

## 周报

周报保留，但定位已经从“健康数据大盘”改为“这一周有什么变了”。当前版本按本周与此前稳定窗口比较，并明确标记为**本地 Demo 即时生成**，不虚构真实定时推送。

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
- 有理由追问；
- `pending → completed` 任务状态机。

## 运行

```bash
cd route1-health-agent
npm install
npm run dev
npm test
```
