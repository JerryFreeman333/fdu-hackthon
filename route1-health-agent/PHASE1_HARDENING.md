# Route 1 Phase 1 Hardening

## 当前安全语义

Route 1 的家庭协同遵循两层原则：

1. 长期共享（`persistent`）必须由老人明确授权，并只呈现真正需要家属介入的 finding。
2. 一次性共享（`one_time`）不是永久白名单。它先在当前 Demo 会话内 claim，再允许对应 finding / family event 进行一次披露；claim 后不再把授权写回浏览器持久存储。

## 一次性共享不变量

- 未携带显式 one-time claim 时，`one_time` 内容不可见。
- claim 后授权只存在当前 React 会话内；刷新页面、重新打开页面或重新选择身份都不会恢复旧授权。
- 当前会话内的 claim 路径必须是确定性的；重复 claim 同一 ID 不应重新产生第二份授权。
- `private` visibility 永远优先于 one-time claim。
- 撤销家庭共享会清除尚未消费和已经 claim 的当前会话状态。
- `familyEligible` 必须严格为 `true`，不能把缺省值视为允许共享。

## Demo 身份与授权边界

当前 Demo 将以下内容全部视为**安全敏感会话状态**，只保存在 React 内存中，不从 `localStorage` 恢复：

- 当前角色（老人 / 家属）
- 家庭共享同意状态
- 家属绑定状态
- 当前邀请码
- 一次性 finding / family event grant

因此浏览器中残留的旧 `ROLE_KEY`、consent、family link 或 one-time share 数据不会重新获得访问权限。刷新页面会重新进入身份选择，并要求重新完成演示授权流程。

健康记录本身仍可由 `healthRecordStore` 做本地 Demo 持久化；这不应被理解为鉴权机制。家属端只有在当前会话重新建立合法的演示绑定与共享条件后，才会得到相应展示数据。

## Demo 限制

这仍然不是生产级身份认证。浏览器内存状态只是为了让 Demo 不把 `localStorage` 当作权限边界；真实产品必须使用服务端账号、会话、授权记录和服务端数据过滤，并由服务端重新计算家属可见范围。

真实产品应把 one-time grant 建模为服务端不可重放的授权记录，并在服务端原子消费，同时绑定用户、设备/会话和过期时间。