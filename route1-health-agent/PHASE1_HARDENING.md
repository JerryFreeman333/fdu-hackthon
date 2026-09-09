# Route 1 Phase 1 Hardening

## 当前安全语义

Route 1 的家庭协同遵循两层原则：

1. 长期共享（`persistent`）必须由老人明确授权，并只呈现真正需要家属介入的 finding。
2. 一次性共享（`one_time`）不是永久白名单。它只允许当前 Demo 会话显式 claim 的 finding / family event 进行一次披露；刷新或重新打开页面不会恢复旧 grant。

## 会话敏感状态

以下状态全部只存在当前 React 会话，不从 `localStorage` 恢复：

- 当前角色（老人 / 家属）
- 家庭共享同意状态
- 家属绑定状态
- 当前邀请码
- 一次性 finding / family event grant
- 健康 `events`
- `familyEvents`
- `chat`
- 家属协同任务

因此旧浏览器中的 role、consent、family-link、one-time-share、health-record 或 task 数据不会重新获得访问权限。刷新页面会重新进入身份选择并重新建立当前 Demo 会话。

## 一次性共享不变量

- 未携带显式 one-time claim 时，`one_time` 内容不可见。
- claim 后授权只存在当前 React 会话内。
- 重复 claim 同一 ID 不产生第二份授权。
- `private` visibility 永远优先于 one-time claim。
- 撤销家庭共享会清除当前会话中的授权状态，但不会无故删除已经建立的家属关系。
- `familyEligible` 必须严格为 `true`，不能把缺省值视为允许共享。

## 健康数据隔离不变量

- 新页面/新 JavaScript 会话不得继承上一会话的健康 events、family events、chat 或任务。
- 同一页面内切换老人/家属角色可以继续访问当前会话状态，但必须继续经过当前角色和授权过滤。
- Store `load()` 返回副本，调用方修改返回值不得反向修改内部状态。
- `clear()` 必须同时清除 events、familyEvents 和 chat。
- 任务不得绕过健康事件生命周期，不能在事件被纠正后继续残留为 ghost task。

## 家属最小披露

家属端只允许看到真正需要家属介入的 finding 和协同任务。私密 finding 不得通过通用 `safety_check` 任务旁路泄露。

## Demo 限制

这是有意采用的 Demo 安全边界，不是生产级身份认证。真实产品必须使用服务端账号、老人/租户 ID、会话、家庭关系、授权记录和服务端数据过滤，并由服务端原子消费 one-time grant。

真实产品还应提供设备/会话绑定、过期时间、并发控制、审计日志和跨设备一致性。