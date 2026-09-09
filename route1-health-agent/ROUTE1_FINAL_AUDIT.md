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

## B. 本轮 CI 已实际通过

PR #25 最新有效提交的 Route 1 CI 已通过：

- Prettier formatting check
- TypeScript typecheck
- 全部测试
- Production build
- Security checks
- High-severity dependency audit
- Full dependency audit（informational）

因此本审计不是基于“本地猜测”，而是建立在 GitHub Actions 实际执行结果之上。

## C. 三个视角的验收结论

### 1. 老人视角

核心要求是：老人说别人时，系统不能把别人的健康事实写成自己的；老人要求私密的信息不能因为之后出现同标签而泄露；比较式改善不能被粗暴当成否定；同一句里多个主体不能互相吞掉。

当前代码与回归测试满足这些核心不变量。

### 2. 家属视角

核心要求是：家属只看到当前授权范围内、并且 finding 本身允许家庭协同的信息；撤销共享后不能依靠旧 one-time ID 继续获取私密或不应共享的事实。

当前实现满足本地 Demo 下的这些授权边界。需要特别注意：历史上已经实际发送给家属的内容不能被软件“假装撤回”，审计记录与当前可见性必须分离。

### 3. 对抗者 / 误用视角

最重要的 fail-closed 条件已经覆盖：

- 不明确主体时不默认 `self`；
- conflicting privacy intent 不默认 share；
- `familyEligible=false` 不可被 one-time finding ID 绕过；
- legacy 无 lineage 数据不通过猜测进行 destructive rollback；
- 历史 private tag 不再形成全局 deny-list，避免错误阻断独立紧急事件。

## D. 尚不能由当前自动化测试证明的项目

### 真实多设备权限安全

当前 Route 1 明确是浏览器本地 Demo。角色、共享状态和部分状态保存在 `localStorage`；这不能等同于真实产品的身份认证、授权、服务端访问控制或跨设备一致性。

上线前必须替换为服务端身份与授权模型，并使“谁有权查看哪一条 family event”在服务器端再次校验。

### 真实 UI 人工验收

当前 CI 是 TypeScript/单元/行为级黑盒测试，并不等于完整浏览器人工验收。仍需要人工确认：

1. 老人端实际输入第三人称表述后，界面是否明确要求澄清，而不是给出看似确定的回答；
2. 撤销家属共享后，家属端页面是否立即清空已禁止显示的 detail / observation；
3. 家属端重新进入或刷新页面后，旧 one-time 内容是否仍不可见；
4. 重复点击/快速重复发送是否不会产生重复任务或重复 UI 消息。

## E. Merge Gate

在没有完成上面的真人 UI 验收之前，不把本 PR 描述为“生产级医疗隐私安全已完成”。

当前可以准确描述为：

> Route 1 本轮已通过代码级、行为级和 CI 级安全回归；剩余风险主要集中在 Demo 的本地权限模型与真实 UI/跨设备环境，而不是本轮已经定位的六类核心逻辑回归。
