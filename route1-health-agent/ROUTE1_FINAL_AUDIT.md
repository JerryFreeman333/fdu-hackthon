# Route 1 Final Black-Box Security Audit

日期：2026-09-09

本文件记录 Route 1 PR #25 的最终对抗式验收边界。目标不是证明“绝对安全”，而是确认已识别的真实用户、隐私、数据隔离和任务生命周期问题不会被另一条路径绕过。

## A. 代码与自动化回归不变量

| 场景                               | 必须成立的不变量                                                             | 当前覆盖                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `我觉得他喘得厉害`                 | 不得静默进入老人本人健康流；无唯一主体时保持 `unknown`                       | `tests/user-input-regression.test.ts`                                   |
| 唯一家属上下文 + `他`              | 可继承唯一家属，但不得进入老人本人档案                                       | `tests/user-input-regression.test.ts`                                   |
| 多家属上下文 + `他`                | 不得猜测主体，fail closed                                                    | `tests/user-input-regression.test.ts`                                   |
| `我爸今天没吃降压药，我也没吃`     | 爸爸与老人本人 claim 独立存在                                                | `tests/user-input-regression.test.ts`                                   |
| `今天没有像昨天那样喘得厉害了`     | 当前日期 + occurred/improving 语义，不得整句否定                             | `tests/user-input-regression.test.ts`                                   |
| 历史 private 跌倒 + 今日可共享跌倒 | 历史 private 不得按 tag 全局屏蔽今日独立 finding                             | `tests/detection-privacy-isolation.test.ts`                             |
| private finding                    | 老人端仍能安全升级，家属端不得被动共享                                       | `tests/detection-privacy-isolation.test.ts`                             |
| 更正 claim                         | 仅删除对应 `claimId` 的事件/派生 measurement                                 | `tests/claim-lineage.test.ts`, `tests/stateful-correction-flow.test.ts` |
| 老日期 legacy event 无 claimId     | 不得猜测删除                                                                 | `tests/claim-lineage.test.ts`                                           |
| 家属最小披露                       | 仅 `familyEligible === true` 的 alert/urgent finding 可进入 finding 共享视图 | `tests/family-disclosure.test.ts`, `tests/family-sharing-state.test.ts` |
| task 旁路                          | private finding 关联 task 不得绕过 family disclosure                         | `tests/family-disclosure.test.ts`                                       |
| one-time grant                     | 必须显式 claim；刷新/新会话不得恢复                                          | `tests/family-sharing-state.test.ts` + session-only implementation      |
| one-time + private                 | private 优先，不能通过旧 ID 绕过                                             | `tests/family-sharing-state.test.ts`                                    |
| 同日漏服药                         | 稳定 `task-medication-${today}`，不得重复                                    | `tests/task-regression.test.ts`                                         |
| 任务 session 隔离                  | 不得从 localStorage 恢复旧任务                                               | `useCareTasks.ts` + security policy                                     |
| 健康 store session 隔离            | 新 store/新页面不继承 events/familyEvents/chat                               | `tests/health-store-isolation.test.ts`                                  |
| store 返回值                       | 外部 mutation 不得修改内部快照                                               | `tests/health-store-isolation.test.ts`                                  |
| `clear()`                          | events/familyEvents/chat 全部清空                                            | `tests/health-store-isolation.test.ts`                                  |
| role/授权持久化                    | `localStorage` 不得成为访问控制依据                                          | `App.tsx`, `useFamilyBinding.ts`, security policy                       |
| external LLM                       | private/no-record 不送外部；payload 运行时验证；unsafe reply 回退规则适配器  | `agent.ts` + adapter tests                                              |

## B. 最终安全边界

当前 Demo 将以下内容视为会话敏感状态，只保存在 React / JS 会话内存：

- 当前角色；
- 家庭绑定；
- family sharing consent；
- 当前邀请码；
- one-time grant；
- health events；
- family events；
- chat；
- care tasks。

浏览器 `localStorage` 不承担这些内容的恢复职责。旧版本遗留的 `ROLE_KEY`、consent、family-link、one-time-share、health-record 和 task keys 即使存在，也不会重新获得当前会话权限。

## C. Chromium 黑盒验收

当前最终套件：`p0-blackbox/run-final-blackbox.mjs`。

旧入口 `p0-blackbox/run-p0.mjs` 已降级为兼容 wrapper，不再注入旧的 localStorage consent。

最终套件包含九个核心场景：

1. 第三人称主体隔离；
2. 混合主体 claim；
3. private 家属披露边界；
4. 刷新后的身份/数据隔离；
5. task 残留隔离；
6. claim lineage 更正；
7. 比较式改善；
8. one-time 授权刷新后不复活；
9. 历史 private 与今日独立风险隔离。

**当前不能把历史 P0 screenshots / `p0-results.json` 当成最新 head 的黑盒通过证据。** 当前分析环境没有可用 Playwright runtime，因此本轮本地 Chromium 执行状态应记为 `BLOCKED`，而不是 `PASS`。

仓库 CI 已增加独立 `blackbox-route1` job，使用 Chromium 执行最终套件；只有该 job 与静态 CI 全部通过，才能把黑盒门槛标记为 PASS。

## D. CI 状态

当前 PR #25 head：`8fefe9a48af1decf9ac55d4c7ab36b5077e8e624`。

已知旧 Route 1 run #635 在较早 commit 上失败，失败步骤为 Prettier formatting check；随后代码已经继续修改，不将该旧 run 作为当前版本结论。

截至本审计记录更新时间，GitHub Actions API 对当前精确 head 尚未返回 workflow run。因此：

- 当前 CI 不能标记为 PASS；
- 当前 black-box 不能标记为 PASS；
- PR #25 不应合并。

必须等待/触发当前 head 的正式 CI，并至少核对：

`npm ci → format:check → typecheck → tests → build → security:check → high-severity audit → Chromium black-box`。

## E. 最终发布判断

### 已解决

Route 1 的核心真实用户回归、主体归属错误、历史 private 全局污染、家属最小披露、one-time 重放、授权 localStorage 伪造、健康数据跨会话残留、任务跨会话残留以及主要 correction/task 幂等问题已经在代码层处理，并有相应回归/安全策略覆盖。

### 尚未满足发布条件

**当前 head 的 CI 尚未得到实际绿色结果。**

**当前 head 的 Chromium 黑盒尚未在可验证环境中实际执行。**

因此当前结论只能是：

> **代码 hardening 已完成，但 Route 1 仍处于 RELEASE BLOCKED 状态。不得把本轮审计描述为“全部测试通过”。**

生产版本仍必须迁移到服务端身份、租户/老人 ID、会话、授权、原子 one-time token、服务端数据过滤、审计日志和真实设备验收。
