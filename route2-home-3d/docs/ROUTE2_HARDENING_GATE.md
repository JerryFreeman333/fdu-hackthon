# Route 2 Hardening Gate

日期：2026-09-09
分支：`route2-hardening-2026-09-09`

## 目标

把当前 Home Twin 原型从“可以显示 3D / 检测对象 / 生成候选路线”推进到“任何面向用户的安全建议都有明确空间证据、版本来源和能力边界”。

## P0-01 Route Eligibility

### 必须满足

- 起点和终点对象存在且通过 schema 校验。
- 所有关键 `connects` 关系都有明确来源，不允许 `demo` 关系直接作为真实安全路线依据。
- 关键关系置信度达到统一门槛。
- 路线所属 `homeId`、snapshot `version` 与当前风险上下文一致。
- 存在被 `blocks` 标记的关键节点时，路线不能把该节点当作可通行节点。
- 不满足任一条件时，结果必须明确为“无法可靠规划”，而不是返回一条看似确定的安全路线。

### 禁止

- 把几何最短路径直接叫做“老人安全路线”。
- 用 demo 数据冒充真实视觉证据。
- 在关系证据不足时凭空补 `connects / blocks / on-route`。

## P0-02 Absolute Distance Guard

- `scaleConfidence = 0` 时，只允许使用无单位的相对几何量进行内部排序。
- UI / Agent 不得输出“2.3 米”“距离门口 1.5 米”等绝对距离。
- 只有存在明确尺度锚点并达到统一门槛后，才允许输出米制距离。
- 所有米制输出必须能够追溯到当前 Home Twin snapshot 的尺度证据。

## P0-03 Rescan Provenance

复扫结果必须至少绑定：

- `homeId`
- 上一轮 snapshot version
- 当前 snapshot version
- risk rule version
- rescan batch / reconstruction identity

没有完整 provenance 时，只能进入“待人工确认”，不得自动关闭旧风险。

## P1-01 Hazard Coverage

`on-route` 关系代表“已经有证据确认与当前路线相关的危险项”，不能声称覆盖空间中的所有危险物。

当路线没有显式 `hazardIds` 时，风险层必须将路线危险覆盖标记为 `unknown`，不得退回使用全屋同类危险物列表推断“这条路线存在该危险”。

## P1-02 Risk Evidence Lineage

每一个 Risk 必须能回溯到：

`Risk → evidence object/relation → snapshot/version → capture/reconstruction provenance`

Person × Home 风险结果现在通过 `evidenceRefs` 显式记录 Person Twin、Home Twin 版本以及具体 Home Object。

每一个 Action 必须能回溯到：

`Action → riskId → evidence`

## P1-03 Person × Home Boundary

人物因素只能作为独立 risk layer 注入，例如：

- 夜间起床频率
- 行走能力
- 视觉/认知辅助需求
- 使用助行器等设备

视觉层不得自行推断医学状况。Person 层与 Home 层通过显式输入契约结合。

## 自动化 Gate

进入真人 UI 黑盒验收前，必须至少有：

1. route eligibility tests
2. no-scale absolute-distance tests
3. rescan provenance mismatch tests
4. risk-to-evidence lineage tests
5. demo-source cannot masquerade as real-source tests
6. route hazard coverage tests

## 真人 UI Gate

必须人工确认：

1. 证据不足时，UI 显示“无法可靠判断/需要补拍”，而非伪造确定结论。
2. 没有尺度标定时，用户界面不出现米制距离。
3. 复扫使用旧版本结果时，不会自动把当前风险标为已解决。
4. 家属看到的每条建议都能说明“哪里、什么风险、为什么现在行动”。
5. 路线上没有明确 hazard evidence 时，UI 不把全屋危险物冒充为该路线危险物。
6. 风险详情可以定位到具体 Home Object 与 snapshot version。

## Merge Gate

以上自动化测试全部通过 + P0 UI 场景全部 PASS，才能进入 Route 2 PR 合并候选。
