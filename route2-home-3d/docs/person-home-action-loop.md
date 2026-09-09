# Person Twin × Home Twin：家庭行动闭环

Route 2 不以风险分数作为终点，而是形成：

`Person Twin → Home Twin → risk projection → family action → rescan → resolved`

## Risk projection

`person_home_risk.py` 只接收显式 Person Twin 功能字段和 Home Twin 空间对象/路线证据。它保持 `non-diagnostic`，不输出疾病概率。

当表面路线暂时没有 `hazardIds` 时，风险层会保守回退到已识别的 `rug / cable / threshold`，避免因为字段缺失而产生假阴性。

## Family action

`person_home_action_plan.py` 将每条风险生成一个带 `riskId` 的家庭任务。任务默认要求复扫，并带有 `risk-disappears-after-rescan` 关闭规则。

复扫后，如果对应风险已经消失，任务变为 `resolved`；若风险仍存在，行动计划保持 `open`。

## 产品语义

家属看到的重点应该是：

`发生了什么 → 为什么现在值得处理 → 具体做什么 → 做完怎么确认`

而不是展示一个未经现场验证的“安全分数”。

## 当前边界

这是功能状态与空间证据的工程组合，不是医疗诊断、跌倒概率模型或经过临床验证的安全评级。实际家庭部署前仍需要真实尺度、连续表面/门洞净宽、设备差异和现场步行验证。
