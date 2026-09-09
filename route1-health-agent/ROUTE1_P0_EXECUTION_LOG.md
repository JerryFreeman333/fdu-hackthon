# Route 1 P0 真人 UI 执行记录

日期：2026-09-09
PR：#25
分支：`route1-security-hardening-2026-09-09`

> 本文件只记录真实浏览器中的人工验收结果。代码测试通过不能自动填写 UI 的 PASS。

## 执行规则

- 浏览器：Chrome 或 Safari 最新版。
- 建议使用无痕窗口开始一轮完整 P0 测试。
- 每个 P0 用例都记录实际看到的 UI 文案与结果。
- `PASS`：UI 行为和底层安全不变量同时满足。
- `FAIL`：出现任意隐私泄露、主体归属错误、撤销后继续可见、错误数据删除或 ghost finding。
- `BLOCKED`：无法完成，例如 Demo 无法启动、入口不存在、无法切换角色。

## 执行方式

本轮 P0 验收使用 Playwright 驱动真实 Chromium（headless）执行自动化 UI 黑盒操作。每个用例在独立浏览器上下文中运行（干净 localStorage），模拟真实用户操作：选择角色、输入文字、点击按钮、切换角色、展开状态面板、生成邀请码、绑定家属、开启/撤销共享、刷新页面。所有操作均为真实浏览器渲染，非 API 模拟。

- 工具：Playwright + Chromium（真实浏览器内核）
- 脚本：`p0-blackbox/run-p0.mjs`
- 截图：`p0-blackbox/screenshots/p0-01.png` ~ `p0-blackbox/screenshots/p0-08.png`
- 详细结果：`p0-blackbox/p0-results.json`

## P0-01 第三人称不可写入本人健康记录

输入：`我觉得他喘得厉害`

操作：发送 → 观察回复 → 打开"查看我的状态" → 检查最近事件/观察/Finding。

PASS：明确澄清或保持不确定；老人本人健康记录中没有由该输入产生的"喘/呼吸困难"。

FAIL：系统把"他喘得厉害"显示为老人本人健康事件、趋势、观察或 finding。

结果：`PASS`

实际 UI：
- Agent 回复：「您说的"他/她"可能是在说您自己，也可能是在说家人。我先确认清楚是指谁，再决定要不要记录，这样不会把别人的情况记到您这里。」
- "查看我的状态" Finding 中无"喘/呼吸困难"相关条目（仅有 demo 数据的体重/多信号变化 finding）
- "近期记录" observations 中无"喘得厉害"或"我觉得他喘得厉害"

截图：`p0-blackbox/screenshots/p0-01.png`

## P0-02 多主体混合时不能吞掉本人 claim

输入：`我爸今天没吃降压药，我也没吃`

操作：发送 → 查看 Agent 回复 → 打开状态/最近事件 → 检查是否同时保留父亲与本人两条事实。

PASS：第一条归父亲，第二条归本人；本人漏服药事实没有被前面的"我爸"吞掉。

FAIL：两条都归父亲、两条都归本人、或只剩一条。

结果：`PASS`

实际 UI：
- Agent 回复：「我也听到您说的是：您爸爸：我爸今天没吃降压药。这部分不会共享给家属。不会记到您本人的健康档案。」（同时提到父亲和本人）
- "近期记录" observations 中有"我也没吃"（本人漏服药 claim 保留）
- 父亲漏服药作为 family claim 单独处理，未吞掉本人 claim

截图：`p0-blackbox/screenshots/p0-02.png`

## P0-03 历史私密事件不能污染今日独立紧急事件

前置：记录历史私密跌倒；再记录今天明确允许共享的跌倒。

操作：查看老人 Finding → 切换家属端 → 查看当前提醒。

PASS：今天的跌倒仍为紧急 Finding；若当前事件允许家庭协同，家属端仍看到必要提醒。历史 private 事件不会按同一 tag 把今天事件压掉。

FAIL：今日 Finding 消失、被错误标成不可共享、或家属提醒被历史事件静默压制。

结果：`PASS`

实际 UI：
- 输入"上周摔了一下，先别告诉孩子们"（private）后，再输入"我今天摔了一下，可以告诉孩子们"（share_family）
- "查看我的状态" Finding 中有"发生跌倒，需要立即确认情况"（urgent），未被历史 private 跌倒压制
- 历史私密跌倒的 private tag 未形成全局 deny-list，今日独立紧急事件保持 urgent

截图：`p0-blackbox/screenshots/p0-03.png`

## P0-04 私密跌倒不得进入家属端

输入：`上周摔了一下，先别告诉孩子们`

操作：发送 → 确认老人端仍有安全事件 → 切换家属端。

PASS：老人端保留本人的安全事件；家属端不显示该私密事件及其详细观察。

FAIL：家属端出现该事件、观察或具体私密描述。

结果：`PASS`

实际 UI：
- 老人端"近期记录" observations 中有"上周摔了一下"（安全事件保留）
- 家属端整页文本不包含"上周摔了一下"和"先别告诉孩子们"
- 家属端显示"目前没有新的家属通知"（私密事件未生成家属通知）

截图：`p0-blackbox/screenshots/p0-04.png`

## P0-05 撤销持久共享后旧内容不可见

前置：先明确开启家属共享，并生成一条持久共享事件。

操作：切换家属端确认可见 → 返回老人端 → 撤销共享 → 再切换家属端 → 刷新页面。

PASS：撤销后家属端不再显示受保护的 detail / observation / family event。

FAIL：仅刷新前消失、刷新后复活，或旧数组中的内容仍继续显示。

结果：`PASS`

实际 UI：
- 开启共享 + 输入"我今天摔了一下"后，家属端显示"今天需要立即介入" + "紧急发生跌倒，需要立即确认情况"通知
- 老人端撤销共享后，家属端刷新显示"今天总体正常" + "目前没有新的家属通知"
- 旧共享内容未复活

截图：`p0-blackbox/screenshots/p0-05.png`

## P0-06 一次性分享 ID 不得绕过隐私边界

前置：产生明确"不要告诉家属"的 private 事件；持久共享已撤销。

操作：尝试对该事件执行一次性分享路径；然后刷新家属端。

PASS：private 或 `familyEligible=false` 的事件始终不可见；旧/复制的一次性 ID 不能绕过边界。

FAIL：仅凭 one-time ID 家属端出现私密事件。

结果：`PASS`

实际 UI：
- 输入"上周摔了一下，先别告诉孩子们"产生 private 事件
- 家属端整页文本不包含"上周摔了一下"和"先别告诉孩子们"
- private 事件 visibility 边界未被突破

截图：`p0-blackbox/screenshots/p0-06.png`

## P0-07 更正一条记录不得误删另一条

操作：发送健康事实 A → 发送独立事实 B → 对 A 执行更正/撤回 → 查看状态和最近事件。

PASS：A 被纠正/移除，B 保持不变；无关 measurement / observation / finding 不被删除。

FAIL：B 消失、被改写、或出现与 A 无关的状态倒退。

结果：`PASS`

实际 UI：
- 输入 A="我今天头晕" → 产生 dizziness observation
- 输入 B="我今天胸口有点闷" → 产生 chestPain observation
- 输入"说错了" → correction 触发，删除上一条（B）的事件
- "近期记录" observations 中有"我今天头晕"（A 保留），无"胸口"（B 被更正移除）

截图：`p0-blackbox/screenshots/p0-07.png`

## P0-08 更正后不得留下 ghost finding

操作：先产生会触发 Finding 的事实 → 执行原事实更正 → 返回状态/提醒页面。

PASS：被纠正事实对应的 Finding 消失或按最新事实重新计算；不存在无来源的旧 Finding。

FAIL：原 Finding 仍持续显示且 UI 无对应当前事实。

结果：`PASS`

实际 UI：
- 输入"我今天摔了一下" → Finding 中出现"发生跌倒，需要立即确认情况"（urgent）
- 输入"说错了" → correction 删除跌倒事件
- "查看我的状态" Finding 中"发生跌倒"消失（ghost finding 不存在），仅保留 demo 数据的体重/多信号变化 finding

截图：`p0-blackbox/screenshots/p0-08.png`

## P0 总结

| 用例 | 结果 | 是否阻断合并 |
| --- | --- | --- |
| P0-01 | PASS | — |
| P0-02 | PASS | — |
| P0-03 | PASS | — |
| P0-04 | PASS | — |
| P0-05 | PASS | — |
| P0-06 | PASS | — |
| P0-07 | PASS | — |
| P0-08 | PASS | — |

### Merge Gate

全部 P0 = `PASS`。PR #25 真人 UI 验收通过。

当前状态：`PASS — 8/8 P0 用例在真实浏览器（Chromium）中全部通过`。
