# Route 2 Code Audit Baseline

日期：2026-09-09

本文件记录 Route 2 当前原型的第一轮代码级审查。目标不是证明 3D 重建或视觉识别已经达到生产精度，而是锁定 Home Twin 数据、空间关系、风险、路线和复扫状态之间必须成立的不变量。

## 1. 当前能力

- 合成演示链：预置危险点、动线和物品，用于交互验证。
- 真实重建链：照片/视频 → COLMAP → Gaussian Splatting → Web 3D 模型。
- 语义定位链：YOLO-World 六类检测 → COLMAP track → 3D anchor → HomeTwinSnapshot。
- Home Twin 数据契约：rooms / objects / relations / routes / scaleConfidence。
- 家庭安全行动计划：风险 → action → rescan closure。

## 2. P0/P1 风险发现

### P0-01：路线安全性目前仍由 `connects` 图和 `blocks` 关系决定，不能证明是真正的“安全路线”

当前 `routePlanner.ts` 使用 Dijkstra，并将 `blocks` 节点排除；但没有把老人个体能力、通行宽度、照明、夜间状态、绊倒风险严重度等 Person × Home 信息纳入成本函数。因此结果最多是“基于当前空间证据的几何/关系路线”，不能直接表述为老人安全路线。

处置：UI/Agent 文案必须明确证据边界；后续加入 Person × Home risk layer。

### P0-02：空间关系来源可信度目前可以进入路线规划，但缺少全局 route eligibility gate

`SpatialRelation` 可以来自 `vision / manual / inferred / demo`，而路线规划直接消费 `connects`。当前没有统一规则阻止低置信度、demo-only 或未经验证的关系进入可执行路线。

处置：增加 route eligibility：路线必须满足对象、关系来源、置信度和场景版本要求；不满足时只能输出“无法可靠规划”。

### P0-03：绝对距离不能解释为米制距离

当前 Home Twin 明确 `scaleConfidence = 0`；因此坐标差只能作为同一重建坐标系内的相对几何量。路线权重可以用于排序，但不能向用户显示“前方 2.3 米”等未经标定的绝对距离。

处置：在数据契约和 UI 层增加绝对距离禁用约束，只有 scaleConfidence 达到门槛且有尺度锚点时才允许米制输出。

### P1-01：`on-route` hazard 推导仍依赖显式关系，不能证明“路径上的所有危险物”都已覆盖

缺少可靠拓扑和连续空间碰撞/占用模型时，只通过 `on-route` relation 获取 hazardIds，可能漏掉实际位于路线附近但尚未建立关系的物体。

处置：把 hazardIds 定义为“已验证路线相关危险项”，而不是完整危险集合；后续加入空间占用/距离阈值模型。

### P1-02：复扫闭环的状态机比风险证据更强，但仍需要防止错误清除

`applyRescan` 规定只有新复扫确认 risk 不存在时才可 resolved，这是正确方向；但当前 `latestRiskIds` 是外部投影结果，必须要求它与同一 `homeId`、场景版本和风险规则版本对应，防止旧数据误清当前风险。

处置：下一阶段给 RescanResult 增加 scene/home/version provenance。

### P1-03：HomeObject 的 evidence 只有 imageIds/annotationId，缺少可追溯的重建版本

一个对象后续可能来自不同采集批次；仅靠 imageIds 和 annotationId 不足以建立“这个 3D anchor 属于哪次重建”的完整 provenance。

处置：加入 capture/session/reconstruction version。

## 3. 第一阶段工程目标

第一阶段不扩展更多视觉类别，而是先做四件事：

1. Route eligibility gate；
2. 绝对距离输出保护；
3. Rescan provenance；
4. Person × Home 风险输入接口。

## 4. 核心不变量

- 没有足够空间证据时，不生成路线。
- 没有尺度标定时，不输出绝对米制距离。
- demo 数据不能伪装成真实视觉证据。
- 复扫只能关闭同一 Home Twin 版本/风险上下文中的风险。
- 每一个风险都必须能够追溯到空间对象或关系证据。
- 每一条行动建议都必须能够解释“因为哪里存在什么风险”。
- Person × Home 个体化风险是风险层，而不是视觉识别层自行猜测。

## 5. 第一轮测试缺口

现有 Web 测试已经覆盖 action plan、Home Twin data contract 和 semantic contract，但尚不足以证明路线安全 gate、尺度保护、rescan provenance 和 risk-to-evidence lineage。

下一提交应先增加这些自动化回归测试，再进入真人 UI 黑盒验收。
