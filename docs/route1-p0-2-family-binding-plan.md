# 路线一 · P0-2 改进方案：跨设备家属绑定握手

> 状态：已实施（见 `route1-health-agent` 对应提交）。
> 本文先回答"为什么原来在代码层面就不可能成功"，再给出本轮的修复方案与验收矩阵。

## 一、问题回顾：死局的四道门

原实现里，跨设备/跨 tab 绑定在四道门上依次被锁死，任何一道不打开都是死局：

1. **邀请码只活在生成它的那个 tab 的 React 内存里**
   `useFamilyBinding.ts` 的 `issuedInviteCode` 是 `useState`，注释自称
   "deliberately not restored from localStorage"。`bindFamily(code)` 用
   `inviteCode !== issuedInviteCode` 做本地比对——在**任何其它 tab、任何其它设备**上
   这个比对必然失败，返回 false。
2. **`family.link` 协议只写了半截**
   `useCrossTabSync.ts` 的消息协议里定义了 `family.link`，但 `App.tsx` 的接收端只处理
   `dispatch.acknowledge` / `dispatch.append`，`family.link` 没有任何生产者与消费者。
3. **家属端在绑定前根本不存在协同通道**
   `App.tsx` 把 `peerId: familyLink?.inviteCode` 传给 `useCrossDeviceSync`——家属端在
   绑定成功前 `familyLink` 是 null，所以 PeerJS 通道永远不会打开。即使把第 2 条实现了，
   跨设备的 request 也送不到老人端。这是最隐蔽的一道门：通道的存在以绑定的成功为前提，
   而绑定的成功又以通道为前提。
4. **失败后没有恢复入口**
   老人端生成邀请码后按钮被"⏳ 等家人输入…"横幅替换，没有"重新生成"。家属端看到
   "邀请码无效或已失效，请让老人重新生成"，但老人端无法重新生成——双方被同时锁死。

黑盒测试只覆盖了"同 tab 切角色绑定"和"诚实的失败状态"两条路径，所以 CI 全绿而核心
承诺（"两台手机实时协同"）为假。

## 二、方案：把绑定变成一次以邀请码为共享密钥的握手

**核心思想**：邀请码就是（demo 级的）共享密钥。谁能在正确的通道上出示这个码，老人端
就视为"老人本人把码给了这个人"——握手通过即绑定。校验逻辑必须发生在**拥有这个码的
老人端**，而不是输入方的本地内存。

### 2.1 三层递进通道，逐层兜底

家属端点击"绑定"后按序尝试，任何一层成功即绑定成功，全部失败才报错：

| 层 | 通道 | 覆盖场景 | 超时 |
|---|---|---|---|
| L1 | 本地比对 | 同一个 tab 里切角色（回归保留） | 即时 |
| L2 | `family.link` 握手 × BroadcastChannel | 同一浏览器的两个 tab（评审最常见的演示形态） | 1.5s |
| L3 | `family.link` 握手 × PeerJS DataChannel | 两台真设备 | 拨号 10s + 应答 10s |

失败时按层归类原因，向家属端如实展示，绝不伪装成功（延续"诚实失败"原则）。

### 2.2 握手协议（`family.link` 消息补完）

复用既有 envelope（`{ tabId, fromRole, type, payload, at }`），`type: 'family.link'`，
payload 三种：

```jsonc
// 家属 → 老人：请求绑定（BroadcastChannel 与 PeerJS 两个通道上语义相同）
{ "kind": "request", "requestId": "lr-<ts>-<rand>", "code": "AN-2026-3858" }
// 老人 → 家属：码匹配 pending 邀请，激活绑定并回执
{ "kind": "accepted", "requestId": "…", "link": { "id", "relation", "displayName", "maskedContact", "inviteCode", "status": "active" } }
// 老人 → 家属：码不匹配 / 非老人端 / 已失效
{ "kind": "rejected", "requestId": "…", "reason": "code_mismatch" | "not_elder" }
```

约定：

- `requestId` 由家属端生成，应答必须带回——防止多个 tab / 多次点击的应答串扰；
- 收到与 `requestId` 不匹配的应答一律忽略；
- 老人端校验在**拥有邀请码的端**进行：`code === issuedInviteCode` 且 link 处于
  pending 时才 accepted，否则 rejected（只回 rejected，不泄漏任何其它信息）；
- accepted 的 `link` 由老人端生成（displayName「已通过邀请码绑定的家属」），家属端
  原样落本地状态——两端看到的绑定关系来自同一份事实源。

### 2.3 PeerJS 通道的关键补丁：家属端主动拨号

- 新增 `peerIdForInviteCode(code)`：peer id 统一加命名空间前缀
  `ankang-r1-<code>`，避免与全球其它 PeerJS 应用的 id 相撞；老人端 host、家属端
  guest、握手临时拨号三处共用同一推导。
- 老人端**不变**：生成邀请码后即以该码为 peer id 起 peer 等待连入（原有行为，
  `cross-device-status-blackbox` 锁定的"等待/失败不伪装"语义保留）。
- 家属端**新增**：握手 L3 里由 `connectToPeer(peerIdForInviteCode(code))` 临时拨号，
  连上后把 request envelope 直接写进 DataChannel，等到 accepted 即断开临时连接；
  绑定成功后 `familyLink.inviteCode` 生效，App 层既有的 `useCrossDeviceSync`
  guest 通道接管后续持续同步（派发台账 / 确认动作 / 健康事件）。
- 这一步同时拆掉了第 3 道门："通道的存在以绑定成功为前提"的循环依赖被打破——
  绑定前用一次性连接握手，绑定后才有常驻通道。

### 2.4 死局兜底：重新生成 + 分类报错

- 老人端 pending 状态卡片：邀请码大字常驻 + **"重新生成邀请码"按钮**（旧码即刻
  失效，家属端输入旧码会得到明确的 rejected）。第 4 道门拆除。
- 家属端绑定按钮异步化：`绑定中…` 进度态；失败按原因分文案：
  - `rejected` →「邀请码不对或已失效。请核对老人端当前显示的邀请码。」
  - `peer_error` / `timeout_peer` →「联系不上老人端的手机。请确认老人端已生成邀请码、
    屏幕亮着，且两台设备都能上网，然后再试一次。」
- 全部失败后输入框里的码保留，可直接改了重试，不回到空状态。

### 2.5 安全语义与已知限制（如实声明，写进 README）

- 邀请码仍是 demo 级 4 位数字：出示正确码即获得绑定资格。真实产品必须换成服务端
  签发的高熵授权 + 二维码/手机号验证。此限制 README 原有声明保留。
- 邀请码仍然**只活在老人端会话内存**：老人端刷新页面后码失效，需要重新生成并重新
  握手。这是有意的隐私取舍（授权态不落盘），不是遗漏。
- 握手成功后，持续同步的仍是派发台账、确认动作与健康事件（本轮把健康事件也加入
  同步，见 P0-1 修复说明）；聊天原文不同步。

### 2.6 改动清单

| 文件 | 改动 |
|---|---|
| `adapters/PeerJSCrossDevice.ts` | 新增 `peerIdForInviteCode()`；`useCrossDeviceSync` host/guest 与握手拨号统一使用 |
| `engine/familyLinkHandshake.ts`（新） | 可注入 transport 的握手编排：L2 → L3、超时、requestId 匹配、原因归类；纯逻辑可单测 |
| `hooks/useFamilyBinding.ts` | `bindFamily(code, transport?)` 三路径化；新增 `confirmLinkRequest()`（老人端校验+激活）与 `acceptRemoteLink()`（家属端落状态）；`generateInvite` 可重复调用（重新生成） |
| `App.tsx` | `sync.subscribe` 补上 `family.link` 分派（request → 校验并应答）；把 `sync` 作为 transport 传给 `bindFamily` |
| `components/ElderHome.tsx` | pending 卡片：邀请码大字常驻 + 重新生成按钮 |
| `components/FamilyDashboard.tsx` | 绑定流程异步化 + 分类报错 + 输入保留 |
| 测试 | `family-link-handshake.test.ts`（单测：L2 成功 / L2 超时回落 L3 / rejected / requestId 不匹配 / 全失败归因）；黑盒补"跨 tab 绑定"用例 |

### 2.7 验收矩阵（评审现场口径）

| 场景 | 修复前 | 修复后 |
|---|---|---|
| 同 tab 切换角色绑定 | ✅ 成功 | ✅ 成功（回归保留） |
| 同浏览器两个 tab，家属输入邀请码 | ❌「邀请码无效」死局 | ✅ 约 1 秒内绑定成功，两 tab 状态即时互通 |
| 两台真设备（信令可达） | ❌ 代码层面不可能 | ✅ 握手绑定成功 → 常驻 P2P 通道持续同步 |
| 两台真设备（信令不可达） | ❌ 同上 | ⚠️ 如实报错 + 指引，老人端可重新生成，不伪装成功 |
| 家属输错码 | ❌「请让老人重新生成」但老人端无法重新生成 | ✅ 明确报错；老人端可重新生成，新码即刻可绑 |
