# Route 1 Phase 1 Hardening

## 当前安全语义

Route 1 的家庭协同遵循两层原则：

1. 长期共享（`persistent`）必须由老人明确授权，并只呈现真正需要家属介入的 finding。
2. 一次性共享（`one_time`）不是永久白名单。它只允许对应 finding / family event 进行一次家属侧披露；家属端进入并完成该次披露后，授权 ID 会从本地持久状态中消费掉。

## 一次性共享不变量

- 未携带显式 one-time ID 时，`one_time` 内容不可见。
- 显式 one-time ID 被消费后，刷新页面、返回首页、重新进入家属端均不能再次获得该授权。
- 消费操作必须是幂等的；重复消费同一 ID 不影响其他授权。
- `private` visibility 永远优先于 one-time ID。
- 撤销家庭共享会清除尚未消费的 one-time IDs。
- `familyEligible` 必须严格为 `true`，不能把缺省值视为允许共享。

## Demo 限制

当前实现仍基于浏览器本地 `localStorage`，因此消费状态解决的是本地 Demo 内的重复复用问题，不等同于真实产品的服务端一次性 token、会话绑定、并发竞争控制或跨设备一致性。

真实产品应把 one-time grant 建模为服务端不可重放的授权记录，并在服务端原子消费。