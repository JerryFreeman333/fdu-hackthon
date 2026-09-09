# Route 2 Code Audit — Cross-Snapshot Hardening

日期：2026-09-09

本阶段重点不是继续扩充视觉能力，而是攻击复扫闭环中的“旧结果回灌”问题：一个结构合法、甚至带有完整 provenance 的旧 action plan，也不能覆盖当前 Home Twin 状态，更不能在页面刷新后恢复成可信的已解决状态。

## 本阶段新增安全不变量

### P0：Cross-Snapshot Acceptance Gate

接受复扫 action plan 必须同时满足：

- `homeId` 与当前基线一致；
- `riskRuleVersion` 与当前基线一致；
- `homeVersion` 严格递增；
- `captureId` 必须变化；
- `reconstructionId` 必须变化；
- candidate `provenance.previous`（若存在）必须与当前基线 provenance 完全一致；
- 所有由复扫关闭的 action，其 `resolvedAtProvenance` 必须与 candidate 当前 provenance 完全一致；
- 不允许通过 `latestRiskIds` 单独完成 closure。

任何一项失败都只能保留旧风险/行动状态并进入失败或待确认状态。

### P0：Reload Is Not a Trust Boundary

浏览器 `sessionStorage/localStorage` 中的数据不能证明新的空间证据已经产生。页面刷新后：

- 可以恢复“上一轮行动基线”；
- 可以保留“正在处理”这一非结论状态；
- 不恢复任何自动关闭状态；
- 必须重新取得并验证新的空间证据；
- 旧的 ready/clear action plan 不得仅因为存在于浏览器缓存而重新成为权威状态。

### P1：Result Envelope Consistency

复扫结果顶层 provenance 与嵌套 action plan provenance 必须一致；后端或中间层返回的匿名 `riskId` 列表不能取代 action plan lineage。

## 当前安全闭环

`Capture → Reconstruction → Home Twin Snapshot → Risk Projection → Action Plan → Resolution Provenance → UI`

其中版本与证据链必须单调向前；旧结果不能覆盖新状态。

## 当前 UI/Agent 边界

- 无法证明新 snapshot 时，不自动关闭旧风险。
- 无法证明新 capture/reconstruction 时，不把结果解释为“复扫确认”。
- 没有真实空间证据时，不宣称物理安全。
- demo fixture 只能作为交互演示，不可成为真实 closure 的证据。

## 自动化回归要求

至少覆盖：

1. 旧 `homeVersion`；
2. 相同 `homeVersion`；
3. `homeId` 不一致；
4. `riskRuleVersion` 不一致；
5. `captureId` 未变化；
6. `reconstructionId` 未变化；
7. `previous provenance` 与当前基线不一致；
8. resolved action 缺少/伪造 resolution provenance；
9. 刷新后恢复 clear/resolved 状态；
10. stale response 不能覆盖更新后的 UI 状态；
11. 连续点击不会产生重复 rescan submission；
12. `latestRiskIds` 不具备 closure authority。

## 真人验收前置条件

上述自动化回归全部通过后，再进行浏览器真人黑盒测试。真人测试重点检查：旧复扫结果回灌、刷新页面、重复点击复扫、切换 Home/版本，以及网络延迟造成的乱序响应。
