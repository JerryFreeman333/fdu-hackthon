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

#### 通知送达与确认闭环

通知不只是“页面上多了一行”，而是有真实的送达台账（`engine/notify.ts`）：

- **派发门控**：只有 `familySharing=granted` 且已完成家庭绑定，才会派发 alert/urgent 通知；私密发现（`familyEligible=false`）永远不进入家属通知；
- **去重**：以发现 ID 为唯一键，同一条通知只派发一次，刷新页面不会重复打扰；
- **逐渠道送达状态**：每条通知记录「通知中心 / 系统通知（浏览器 Web Notifications）」各自的送达结果；权限未开启、渠道失败都会如实标注“未送达”，绝不把未知包装成安心；
- **确认闭环**：家属逐条“确认已知悉”，顶部横幅与待确认计数随之更新；台账持久化在本地，处理进度不会因为刷新丢失。

系统通知权限可在家属端一键开启；真实产品的服务端推送 / 短信渠道应实现同样的 `DeliverFn` 适配器接入台账。

当前家庭绑定与联系老人均为**本地 Demo 模拟**：老人端可生成邀请码，家属端输入邀请码后在本地完成校验和绑定。真实产品需要后端账号体系、二维码/手机号验证及跨设备同步。

### 本地持久化与多设备边界

当前 Demo 的健康数据、聊天记录在**本浏览器的 IndexedDB 中持久化**（`store/PersistentHealthRecordStore.ts`）：老人不小心刷新页面、切后台被杀掉进程，重新打开后数据还在。应用启动时会先水合本地历史再进入主界面，避免首帧写入覆盖历史；IndexedDB 不可用（如浏览器隐私模式）时自动降级为会话内存，功能不受影响。老人端与家属端仍通过"切换身份"在同一浏览器内模拟两个角色。

要如实说明的边界：

- 持久化的范围是**本机浏览器、本浏览器 profile**。换一台手机、换一个浏览器，数据不会跟过去——跨设备数据同步仍需显式的 PeerJS 协同（实时派发台账）或未来的账号体系；
- 数据不上传任何服务器，这是隐私特性，也意味着"清浏览器数据 = 删档"；
- 两台手机实时协同依赖 PeerJS 信令握手，中国大陆网络下建议自建信令，见下文「跨设备协同与信令」。

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

## 理解层 LLM 语义仲裁（标签识别 + 肯否判断）

中文的否定/程度表达是**开放集合**：「不太喘了」「毫不头晕」「一点都不疼」「压根没肿」……用关键词表穷举已被多轮审查证明永远追不上真实口语——而这类误判会直接接入 `detection/safety.ts` 的紧急规则（老人报平安被当成危险信号推给家属）。

比肯否更基础的一层是「这句话有没有提到症状」：`agent.ts` 的 `INTENT_RULES` 各症状窗口宽窄不一（头晕 `{0,2}`、胸口痛 `{0,5}`、摔倒要求紧邻"倒/了"），否定/程度词插进症状词中间或距离超出窗口时（「头一点都不晕了」「摔是没摔，就是腿软了一下」），整句话识别不出任何健康信号——不产生 claim、不追问、界面零反馈，老人会以为话被听懂了。这一层决定"有没有 claim"，出错比肯否误判更隐蔽。

因此理解层的仲裁改为**LLM 优先、规则兜底**的双层结构（`engine/llmUnderstanding.ts`），一次调用同时仲裁两个轴：

```text
老人原话 → 分句
  ↓
① 规则层：标签/数值抽取（INTENT_RULES，结果作为下限）+ 结构化否定检测
   （否定语素 + 窗口 + 正面习语白名单）+ 人物归属 + 隐私边界（全部本地，永远执行）
  ↓
② LLM 仲裁（配置后启用）：对每个子句判断
   - 标签轴 t：涉及哪些症状（规则漏识别的由 LLM 补齐，只增不删）
   - 肯否轴 s：occurred / negated / hypothetical / uncertain / near_miss
  ↓
合并策略：
- 标签轴：规则 ∪ LLM，规则已识别的标签永不被删除；
- LLM 补出新标签时，规则状态是在"看不见这些症状"的前提下算的 → 肯否采 LLM；
- 肯否轴双向采纳 LLM 结论；
- 规则的强词汇信号（可能/好像→uncertain、如果/万一→hypothetical、差点→near_miss）不被覆盖
```

Fail-closed 契约：

- 未配置、超时（默认 8s）、网络错误、返回不合法 → **回落规则结果**，绝不阻塞对话、绝不静默改变语义；
- 隐私意图为 `private` / `no_record` 的输入**不发送给外部模型**，理解交给本地规则；
- LLM 不碰数值抽取、人物归属、分级与回复；标签只增不删。

规则下限也针对审查点名的句式做了最小补充（`agent.ts`，每处均注明是兜底）：dizziness 窗口 `{0,2}→{0,4}`（"头一点都不晕"）、否定语境的裸"晕"（不晕/没晕；正面裸"晕"刻意不收，防晕车/晕船误报）、摔倒的让步构式"X是没X"、"腿（都/发）软"。配套修复了结构化否定里的一个隐藏 bug：否定字出现在较长命中片段内部时（"腿一点也不肿"）曾被长度守卫跳过、误记为发生。

无论走 LLM 还是纯规则，否定与"差点发生"（near_miss）的句子都有点名确认话术（"好的，我知道了：您说的头晕没有发生，或者已经好了……"），不再被"说的是您自己还是家里人？"式追问当成没听懂（`userFacing.buildUnacceptedClaimsReply`）。

配置方式（`.env`，任何 OpenAI 兼容端点，key 只存本地不入库）：

```bash
VITE_UNDERSTANDING_LLM_BASE_URL=https://api.minimaxi.com/v1   # 或智谱/DeepSeek 等 OpenAI 兼容端点
VITE_UNDERSTANDING_LLM_API_KEY=你的key
VITE_UNDERSTANDING_LLM_MODEL=Minimax-M3   # 智谱 glm-4-flash（免费档）/ deepseek-chat 均可
```

**诚实声明**：Demo 阶段 key 经 Vite 注入浏览器，任何打开该页面的人理论上可提取。仅限一次性/免费 key（如 glm-4-flash 免费档）。正式部署必须换服务端代理（同 `VITE_AGENT_LLM_ENDPOINT` 的模式），由代理持有 key 并转发。

**让 key 不进浏览器的本地代理**（推荐，一条命令）：

```bash
LLM_PROXY_API_KEY=你的key npm run proxy   # key 只存在于本机 Node 进程
```

然后把 `.env` 改成代理模式（`VITE_UNDERSTANDING_LLM_API_KEY` 填占位符即可）：

```bash
VITE_UNDERSTANDING_LLM_BASE_URL=http://localhost:8787
VITE_UNDERSTANDING_LLM_API_KEY=proxy
VITE_AGENT_LLM_ENDPOINT=http://localhost:8787/agent/chat   # 可选：回复层也走代理
```

代理支持 `/chat/completions`（理解层透传）与 `/agent/chat`（回复层适配），带 CORS 头；任何上游错误以 502 + 明确 message 返回，不静默。

## 跨设备协同与信令

两台真手机的实时协同走 PeerJS（WebRTC DataChannel），数据不经中转服务器，信令只做握手。需要如实对待的风险：

- **官方公共信令（0.peerjs.com）在中国大陆网络不稳定**，可能导致最核心的"老人手机 ↔ 家属手机"协同静默退化为"两台设备各玩各的"。连接失败时 UI 会如实标注"暂时没连上"，不会伪装成已协同；
- 缓解：自建/国内可达信令。`npx peerjs --port 9000 --key ankang` 起一个信令服务器，然后配置 `VITE_PEER_SIGNALING_URL=http://<服务器>:9000/peerjs`（支持 wss/https）；
- 默认 ICE 列表在 Google STUN 之外并列了国内可达的 `stun.qq.com:3478`；需要 TURN 时用 `VITE_PEER_ICE_SERVERS` 注入 JSON 数组；
- 同浏览器多 tab 的 BroadcastChannel 协同不依赖网络，始终可用作兜底。

演示前建议做一次"断信令演练"：把 `VITE_PEER_SIGNALING_URL` 指向一个不可达地址启动，确认老人端/家属端都出现诚实的降级提示、本地功能完整可用。

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

图像识别保留 `ImageHealthParser` 接口：默认使用明确标注的 Demo parser（不读取图片内容，写入示例数据）；配置 `VITE_HEALTH_VISION_ENDPOINT` 指向服务端视觉代理后，走 `RealImageHealthParser` + `HttpVisionProvider` 真实解析。无论哪种 parser，识别结果都必须经用户在界面上确认，才会进入健康事件流；Provider 按 mg/dL 返回的血糖会自动换算为 mmol/L。

## 医疗安全边界

本项目做的是**状态变化发现、隐私控制和安全分流**，不做疾病诊断，不根据单个异常读数直接下疾病结论。真实产品上线前仍需要临床专家对规则、阈值、误报/漏报和紧急处置文本进行验证。

## 回归测试

单元回归（`npm test`）覆盖：

- 健康事件流：统一事件、按事实去重、更正撤销；
- 变化检测：单指标基线偏移、多信号融合、安全分级、数据稀疏时沉默、同日多次读数的方向性安全规则（低血糖/心动过缓不被正常读数掩盖）；
- 对话理解：人物归属与“接收人”句式、肯否/假设、时间归档、中文与阿拉伯数字抽取（含“一百零五”类零位补零）、错字确认；
- **否定语义组合矩阵**（`negation-combinatorial.test.ts`）：19 种否定/程度标记 × 8 类症状表达的笛卡尔积、痊愈后缀、正面习语防误杀（没睡好/喘不上气/不小心摔了/没劲）、混合辖域追问确认、以及"否定语义端到端不得触发紧急安全规则"的危害链断言——按审查反馈，否定类问题用**组合生成**测试追踪，不再一句一句手挑；
- **理解层 LLM 仲裁**（`llm-understanding.test.ts`）：mock fetch 验证标签轴（规则漏识别补齐、只增不删）与肯否轴双向合并、补标签时强词汇信号优先、超时/HTTP 错误/坏 JSON/网络异常全部回落规则、隐私门控、超长输入跳过；
- **兜底标签回归**（`tag-fallback-regression.test.ts`）：未配置 LLM / private / no_record 场景下，"头一点都不晕了""不晕，但是有点累""摔是没摔，就是腿软了一下"在纯规则模式也留痕不误记，同时锁定防误报边界（晕车/晕船不得记成头晕）；
- **否定/擦边确认话术**（`user-ux-blackbox.test.ts`）：否定与"差点发生"的句子得到点名确认（"头晕没有发生，或者已经好了"），不再被"说的是您自己还是家里人？"式追问当成没听懂；混合不确定语义仍走追问；
- 隐私与家属协同：逐条 visibility、一次性/长期共享与撤销、分享审计、会话隔离；
- **本地持久化**（`persistent-health-store.test.ts`）：save→hydrate 往返、坏数据/版本不符按无历史、KV 写失败降级会话内存、clear 清底层；
- 信令配置（`signaling-config.test.ts`）：自建信令地址解析、非法输入回退、默认 ICE 含国内可达 STUN；
- Agent：规则回复与有理由追问、外部 LLM 上下文的隐私边界（仅公开 Person Twin）；
- 图像解析：parser 选择、严格校验、mg/dL 换算、确认后入库；
- 本地日期与时区安全。

真实浏览器黑盒（本地 `npm run test:browser` / `test:browser:notif` / `test:browser:cross-device`）覆盖角色切换、家属绑定/撤销、一次性共享可见性、拍照确认入库、跨设备状态诚实降级（老人端不出现 P2P/跨设备等技术词、连接失败不伪装成功）等端到端链路。

## 运行

```bash
cd route1-health-agent
npm install
npm run dev
npm test
```

### 可选：启用理解层 LLM 语义仲裁

```bash
cp .env.example .env   # 填入 BASE_URL / API_KEY / MODEL
npm run dev
```

不配置即纯规则模式。配置后：老人说"今天不太喘了"这类话由真实语言模型判定为"症状消失"，不再被记成正在发生；"头一点都不晕了""摔是没摔，就是腿软了一下"这类超出关键词窗口的句子也能被识别出症状并留下事实痕迹（该记的记、该否的否），不再整句无声消失；LLM 不可用时自动回落规则结果。

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
