# Route 1 Final Black-Box Security Audit

日期：2026-09-09

本文件用于记录 Route 1 在 PR #25 的最终黑盒/对抗式验收边界。目标不是证明“系统绝对安全”，而是确认本轮已经修复的真实用户回归不会被当前实现重新引入。

## A. 已由自动化测试验证

| 场景                              | 期望不变量                                                            | 当前验证                                                                    |
| --------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 老人说“我觉得他喘得厉害”          | 不得静默写入老人本人健康流；主体应保持 `unknown` 并要求澄清           | `tests/user-input-regression.test.ts`                                       |
| 已知唯一家属后再说“他……”          | 可以继承唯一明确家属主体，但不得进入老人本人档案                      | `tests/user-input-regression.test.ts`                                       |
| 多个家属候选下再说“他……”          | 不得猜测主体，必须保持 `unknown`                                      | `tests/user-input-regression.test.ts`                                       |
| “我看他今天走路不太稳，摔了一下”  | 前后两个事实都不能变成 `self`；跌倒事实不能丢失                       | `tests/user-input-regression.test.ts`                                       |
| “今天没有像昨天那样喘得厉害了”    | 属于今天的改善中症状，不应被当成完整否定，也不应偷换成昨天            | `tests/user-input-regression.test.ts`                                       |
| “我爸今天没吃降压药，我也没吃”    | 父亲与老人本人必须拆成两条 claim                                      | `tests/user-input-regression.test.ts`                                       |
| 历史私密跌倒 + 今天明确可分享跌倒 | 历史 private 不得按 tag 全局压制今天独立 finding                      | `tests/detection-privacy-isolation.test.ts`                                 |
| 私密跌倒单独存在                  | 老人侧仍可得到安全 finding，但不得生成家属提示                        | `tests/detection-privacy-isolation.test.ts`                                 |
| 更正聊天 claim                    | 只能删除对应 `claimId` 的 chat-derived event                          | `tests/claim-lineage.test.ts`                                               |
| 更正带数值 claim                  | 对应 measurement lineage 必须一并删除，避免 ghost measurement         | `tests/claim-lineage.test.ts`, `tests/stateful-correction-flow.test.ts`     |
| 旧版无 `claimId` 的记录           | 不得通过猜测方式删除，避免误伤历史数据                                | `tests/claim-lineage.test.ts`                                               |
| 撤销长期家属共享                  | 当前家属详细记录与 observation 必须停止进入家属组件                   | `tests/family-sharing-state.test.ts`, `App.tsx`                             |
| 撤销后遗留 one-time finding ID    | one-time ID 不得绕过 `familyEligible=false`；撤销后应清除其未来可见性 | `tests/user-input-regression.test.ts`, `tests/family-sharing-state.test.ts` |
| 重新开启长期共享                  | 已被撤销的旧 one-time event 不得因为重新 grant 而自动复活             | `tests/family-sharing-state.test.ts`                                        |
| 同一天重复服药提醒                | 必须复用当天 `task-medication-${today}`，不得生成重复任务             | `tests/task-regression.test.ts`                                             |
| 服药任务已完成后再次提醒          | 不得克隆新任务                                                        | `tests/task-regression.test.ts`                                             |
| 刷新页面                           | 不得从旧 `localStorage` 恢复角色、家庭授权、绑定或 one-time grant     | App / `useFamilyBinding` 代码审查 + security policy check                   |
| 修改旧 `ROLE_KEY`                  | 不得直接把浏览器持久化字段变成新的身份                                | App 代码审查 + security policy check                                        |
| 修改旧 consent / family-link keys | 不得恢复家庭共享或绑定权限                                             | `useFamilyBinding` 代码审查 + security policy check                         |
| 一次性共享跨标签页并发             | 当前 Demo 不依赖 localStorage 做共享授权；授权只存在当前 React 会话   | `useFamilyBinding` session-only design                                       |

## B. 当前 CI 状态

本轮最新代码已经推送到 PR #25 的 `route1-security-hardening-2026-09-09` 分支；当前 head 为最新硬化提交。

**注意：本文件不把旧提交的 CI 结果冒充为当前 head 的结果。** GitHub Actions 目前尚未返回当前最新 head 的对应 workflow run，因此以下项目仍必须等待/检查当前提交自己的 CI：

- Prettier formatting check
- TypeScript typecheck
- 全部测试
- Production build
- Security checks
- High-severity dependency audit
- Full dependency audit（informational）

旧的失败 run（run #635）对应的是更早的提交，不用于判定当前代码是否通过。

## C. 三个视角的验收结论

### 1. 老人视角

核心要求是：老人说别人时，系统不能把别人的健康事实写成自己的；老人要求私密的信息不能因为之后出现同标签而泄露；比较式改善不能被粗暴当成否定；同一句里多个主体不能互相吞掉。

当前代码与回归测试覆盖这些核心不变量。

### 2. 家属视角

核心要求是：家属只看到当前授权范围内、并且 finding 本身允许家庭协同的信息；撤销共享后不能依靠旧 one-time ID 继续获取私密或不应共享的事实。

当前实现满足本地 Demo 下的这些授权边界。历史上已经实际发送给家属的内容不能被软件“假装撤回”，审计记录与当前可见性必须分离。

### 3. 开发者视角

当前最重要的工程边界是：

- `localStorage` 只能用于 Demo 健康数据持久化，不能承担身份或授权。
- 当前角色、家庭绑定、共享同意、邀请码和 one-time grant 均为会话状态。
- one-time sharing 不再是持久 whitelist；claim 后不能通过刷新恢复。
- 不支持真正认证的 Demo 不能被文档或 UI 描述为“安全登录”。
- 生产版本必须迁移到服务端账号、会话、授权模型和服务端数据过滤。

## D. 本轮新增问题的处理结论

本轮发现并修复的是“浏览器 localStorage 可伪造身份/授权”问题。

修复后，旧的持久化 role / consent / family-link / one-time-share 状态不再作为访问控制依据；刷新页面会重新进入身份选择。与此同时，撤销共享不会误删除已经建立的家属关系，避免安全修复破坏正常的再次授权流程。

这解决了 Demo 层最危险的“把浏览器存储误当权限系统”问题，但**不等同于生产级身份认证**。任何真实上线版本都仍必须在服务端重新验证用户身份、家庭关系、共享范围和数据可见性。
