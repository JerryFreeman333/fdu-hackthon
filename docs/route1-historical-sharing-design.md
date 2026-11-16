# 路线一：既往事实的家属可见性（逐条授权 + 脱敏，已实施）

> 状态：**已实施**。默认拒绝；老人预览后对单条既往事实显式授权，有效期含授权日
> 共 7 个日历日，可随时撤回。跨设备只传输脱敏派生视图，不发送原始
> `HistoricalHealthEvent`。

## 一、边界

- 既往事实写入独立账本 `HistoricalHealthEvent`，不进入 `Observation`
  事件流，不参与今天的检测，也不生成家属通知。
- 授权与 `familySharing` **解耦**：暂停今天的健康共享不会自动撤销历史授权，
  反之亦然。解绑后 `familyLinkId` 变化，旧授权自动失效。
- 家属端没有原始账本、没有聊天上下文、没有来源消息 id、没有录入时间，
  连“一共有多少条未授权事实”都不显示。

## 二、授权模型（`src/engine/historySharing.ts`）

```ts
type HistoricalShareScope = "summary_only" | "summary_with_text";

interface HistoricalShareGrant {
  eventId: string;
  publicId: string;
  scope: HistoricalShareScope;
  familyLinkId: string;
  createdAt: string;
  expiresAt: string; // YYYY-MM-DD，到期当天仍有效
  revokedAt?: string;
  redactions: string[];
}
```

硬约束：

- **逐条授权**：没有“全部历史”开关；每条事实单独生成 grant。
- **默认拒绝**：没有有效 grant 时不渲染卡片、不广播、不显示数量。
- **7 天到期**：`HISTORY_SHARE_DAYS = 7`；例如 11 月 16 日授权，11 月 22 日结束后失效。
  续期必须重新预览并确认授权。
- **撤回生效**：写入 `revokedAt` 后，老人端重新派生完整快照，家属端收到后删除被撤回的内容。
  最后一条撤回时发送空快照。离线家属端在重连或重新打开页面后请求最新快照。
- **换绑失效**：grant 绑定 `familyLinkId`，解绑/换绑后旧授权不再匹配。
- **单写者**：`historyGrants` 只由老人端写 localStorage；家属端不得把
  自己读到的陈旧副本写回去，否则刚撤回的授权会被复活。

## 三、脱敏规则

`summary_only`（默认档）只输出：

| 原字段                           | 输出                    | 规则                                                     |
| -------------------------------- | ----------------------- | -------------------------------------------------------- |
| `tags`                           | 症状标签中文名          | 只保留 `SYMPTOM_LABELS` 中的枚举，未知标签丢弃           |
| `eventDate`                      | `YYYY-MM`               | 精确到日会暴露就诊/住院时间，只给月份；日期不详为 `null` |
| `status`                         | “已发生 / 当时不确定”等 | 枚举映射，不做推断                                       |
| `text`                           | **不输出**              | 原话可能含姓名、医院、住址、家庭矛盾                     |
| `sourceMessageId` / `recordedAt` | **不输出**              | 审计字段，不是健康信息                                   |
| `visibility`                     | **不输出**              | 内部状态                                                 |

`summary_with_text` 额外输出原话，但先跑 `deidentifyHistoricalText`：

- 家属姓名/老人姓名替换为“家人”；
- 手机号、身份证号、银行卡号、邮箱替换为占位符；
- 住址、门牌号、医疗机构名替换为占位符；
- 老人可在预览中补充需要遮蔽的姓名、地点；补充词只保存在老人端授权中；
- 精确到日的日期降为年月（授权界面承诺“只给到月份”，不能靠原话绕过去）；
- 超过 200 字截断，并标注“原话已截断”。

派生 id 是授权时通过 `crypto.getRandomValues` 生成的 128 位随机标识，不由原始 `eventId` 推算。原始 id 形如
`history-live-<Date.now()>-0`，直接透传会把录入毫秒时间送给家属。

## 四、传输与存储

- 老人端只广播 `SharedHistoricalFact[]` 派生视图（`history.share`），
  原始事件、grant、聊天记录都不跨端。
- 跨端载荷经过 `sanitizeSharedHistoryPayload` 结构校验；`summary_only`
  即使携带 `text` 也强制丢弃，`text` 再跑一次脱敏。
- 家属端只持久化绑定关系 id 与派生视图（`SHARED_HISTORY_STORAGE_KEY`），
  到期或收到空快照时删除，而不是仅隐藏。
- `history.share` 校验发送角色、当前绑定关系、字段类型、真实日历日期和枚举；
  `history.request` 用于刷新、唤醒及连接状态变化后的快照补齐。
- 同浏览器双 tab：消息走 BroadcastChannel，共享同一来源的存储，老人端是授权唯一写入方。
  这是角色界面隔离，不是两个账户的数据隔离。跨设备：走现有绑定后的 PeerJS 通道。

## 五、界面

- 老人端：底部“健康档案”中的 `HistorySharingPanel`，不放在折叠区。
  每条显示“允许查看摘要”“允许查看脱敏原话”，先预览，再点击“确认授权，7 天有效”。
  未绑定家属时按钮禁用并提示“先绑定家属后才能授权”。
  已授权时显示“家属可见：仅摘要/含脱敏原话 · 至 YYYY-MM-DD”和“撤回”。
- 家属端：`FamilyDashboard` 的 `SharedHistoryCard`。只显示标签、月份、
  状态、脱敏原话（若授权）和到期日；无授权时整个卡片不渲染。

## 六、测试

单测 `tests/history-sharing.test.ts`：

1. 无授权时派生视图为空；
2. `summary_only` 不含原话、精确日期、来源和录入时间；
3. `summary_with_text` 对姓名、手机号、住址、医院、邮箱、精确日期脱敏并截断；
4. 撤回、到期、换绑后的授权一律失效；
5. 跨端载荷校验拒绝非法结构，`summary_only` 强制丢弃 text；
6. 对外 id 不携带原始 eventId/录入时间。

浏览器黑盒 `tests/family-history-sharing-blackbox.test.mjs`：

老人说出带 PII 的既往事实 → 未绑定时授权按钮禁用 → 绑定后授权摘要 →
家属端只看到年月 → 升级为脱敏原话并补充遮蔽词 → PII 被替换 →
刷新及丢失缓存后重新同步 → 撤回并删除缓存 → 到期隐藏 → 重新授权 → 解绑清理。

## 七、已知边界

- 到期判断依赖客户端时钟；没有服务端授权状态机。设备时钟被回拨时，
  授权可能延后失效。
- 离线期间无法即时接收撤回。没有服务端授权状态机，无法追回家属已阅读或另行保存的内容。
- 自动姓名遮蔽依赖 `knownNames`（老人姓名 + 家属联系人）。未知第三方姓名和非标准写法
  可能漏识别；预览与补充遮蔽词用于老人确认最终共享内容，不承诺完整匿名化。
- 黑盒验证采用同浏览器两标签页，并阻断公共 PeerJS 信令依赖；不等同于两台真实手机的联网验收。
