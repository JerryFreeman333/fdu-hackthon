# Apple Watch + iPhone 真实硬件验收

## 验收链路

```text
Apple Watch → Apple 健康 / HealthKit → iPhone companion
→ 局域网桥接服务 → HealthKitDeviceAdapter → HealthEvent
→ Detection / Finding → Person Twin
```

浏览器不会直接读取 HealthKit。真实模式不包含 Demo fallback；桥接未启动、无样本或响应来源不正确时，页面会明确报错。

## 准实时自动同步模式

比赛模式的稳定链路如下：

```text
HealthKit 变化 → iPhone observer → 5 秒 debounce → 自动读取并上传
→ Bridge revision 递增 → Web 每 7 秒检测 diagnostics
→ revision / receivedAt 变化 → 复用完整同步链刷新 Person Twin
```

- App 启动会注册 observer、请求后台投递，并自动读取/上传一次；已经完成 HealthKit 授权时无需再点“读取”和“上传”。
- observer 覆盖步数、静息心率，以及现有支持的步行速度、血氧和睡眠；多次回调会合并，读取/上传任务不会并发执行。
- `HKHealthStore.enableBackgroundDelivery(..., .immediate)` 只是请求尽快投递。后台是否唤醒及具体时机由 iOS 决定，不保证秒级实时；比赛现场保持 companion 在前台最稳。
- Bridge 每次接受上传后持久化递增 `revision`，并返回 `updatedAt` / `receivedAt`。网页只轮询轻量 diagnostics，revision 与 receivedAt 均未变化时不会重复生成 HealthEvent 或刷新 Person Twin。
- Bridge 断线、token 错误、用户不匹配或数据 stale 时，网页保持 fail-closed，只显示错误，不刷新 Person Twin，也绝不切换到 Demo。

## 0. 准备

- 一台 Mac（用于 Xcode）和一台真实 iPhone；iOS Simulator 不适合验收真实 HealthKit 数据。
- iPhone 已与 Apple Watch 配对，Apple 健康中能看到当天步数或静息心率。
- iPhone 与运行桥接服务的电脑处于同一可信局域网。
- Apple Developer Team；在 Xcode 中选择自己的 Team 并使用唯一 Bundle Identifier。

## 1. 在电脑启动桥接服务

```bash
cd route1-health-agent
npm ci
npm run healthkit:bridge
```

默认监听 `0.0.0.0:8787`，并从 `.env.local` 读取配置。`HEALTHKIT_MAX_AGE_MINUTES=30` 表示超过 30 分钟的最后上传只能作为旧记录保留，GET 会返回 `stale_data`，网页不会把它当成本轮实时验收数据。

可选轻量 Token：在 `.env.local` 同时设置相同的 `HEALTHKIT_BRIDGE_TOKEN` 和 `VITE_HEALTHKIT_BRIDGE_TOKEN`，并在 iPhone companion 中填写同一个值。未配置 Token 时服务仍可用于 MVP，但启动日志会明确警告只能在可信局域网使用。这个临时服务没有账号体系，数据以明文 JSON 暂存在 `.healthkit-data/latest.json`，不可直接用于生产。

Mac 可用 `scutil --get LocalHostName` 查看局域网主机名。若结果为 `Toms-MacBook`，iPhone companion 中填写：

```text
http://Toms-MacBook.local:8787/api/healthkit/measurements
```

如果系统防火墙弹窗，请允许 Node 接受局域网连接。

## 2. 在 Mac 生成并运行 iPhone companion

`native-ios/project.yml` 是 XcodeGen 工程描述：

```bash
brew install xcodegen
cd route1-health-agent/native-ios
xcodegen generate
open AnkangHealthBridge.xcodeproj
```

在 Xcode 中选择自己的 Apple Developer Team，按需修改 Bundle Identifier，确认 HealthKit capability 存在，然后选择真实 iPhone 构建运行。

若不使用 XcodeGen，可在 Xcode 新建 iOS App，把 `Sources` 下四个 Swift 文件加入 target，并把 `Support/Info.plist` 的隐私说明和 entitlement 配到 target。

## 3. iPhone 上自动读取并上传

首次安装仍需点击“请求读取权限”并在系统界面授权。以后比赛现场先启动 Bridge，再打开 companion；App 会自动读取最近 22 天并上传，页面显示“自动同步成功”和 Bridge revision。HealthKit 后续变化会自动触发同一流程。

若自动流程受网络或系统调度影响，下面的三个按钮继续作为现场兜底，原手动流程完整保留：

1. 桥接地址填写电脑的 `.local` 地址；测试用户 ID 必须与 `VITE_HEALTHKIT_USER_ID` 一致。
2. 如果 bridge 开启了测试 Token，在 companion 中填写同一个 Token。
3. 点击“请求读取权限”，允许需要测试的指标。
4. 点击“读取最近 22 天”。
5. 在“最近真实样本”中核对指标、时间和 Apple 来源。
6. 点击“上传到电脑桥接服务”，必须看到“电脑已接收 X 条”。

Apple 为保护隐私，不允许 App 区分“某项读取权限被拒绝”和“该项没有数据”。因此 companion 只显示“权限请求已完成”；最终以样本是否出现和 Apple 健康中的值人工核对。

## 4. 启动真实模式网页

复制 `.env.hardware.example` 为 `.env.local`，然后运行：

```bash
npm run dev -- --host 0.0.0.0
```

进入老人端，展开“真实硬件验收”。真实模式会每 7 秒自动检测 Bridge；发现新 revision 后自动同步。“同步真实健康数据”按钮继续保留作为手动兜底。

## 5. 现场通过标准

- 页面模式条显示 `设备 healthkit`。
- 调试页显示桥接状态、样本数、HealthEvent 数、Finding 数和 Person Twin 刷新日期。
- 调试页显示自动检测已开启、Bridge revision、最近检测时间及最近一次刷新触发方式。
- 样本 `source=healthkit`，数值和时间可与 Apple 健康人工核对。
- 样本保留 source/device/UUID；按天聚合的步数和睡眠标记聚合方法。
- 停止桥接服务后再次同步，页面明确报错，并显示“未使用 Demo 数据替代”。
- 只有将 `VITE_DEVICE_MODE` 改回 `demo` 才会恢复演示数据。

## 5 分钟现场检查（A–E）

### A. 电脑启动 bridge

```bash
npm run healthkit:bridge
```

确认日志出现 `HealthKit bridge listening`、30 分钟 freshness 限制，以及 Token 已启用或无认证警告。

### B. iPhone 最少操作

已授权的比赛机只需打开 companion 并保持前台，确认“自动同步成功”。首次安装需要额外完成一次系统 HealthKit 授权。

自动流程异常时再使用保留的三步手动兜底：

```text
1. 请求读取权限
2. 读取最近 22 天
3. 上传到电脑桥接服务
```

确认显示“电脑已接收 X 条”。

### C. 电脑网页自动同步

确认 `.env.local` 中 `VITE_DEVICE_MODE=healthkit`，运行 `npm run dev`。等待最多约 7 秒，确认 revision 变化触发自动刷新；必要时可点击保留的“同步真实健康数据”。

### D. 人工核对

在 Apple 健康中任选步数或静息心率，核对数值、采集时间和网页显示近似一致，并确认网页显示 `source=healthkit`、来源设备及最近上传/生成时间。

### E. 断线失败验证

停止 bridge，等待一次轮询或再次点击网页同步。页面必须显示失败和“未使用 Demo 数据替代”。重新启动 bridge 后，如最后上传已超过 freshness 限制，页面必须显示“旧数据，不能用于本轮真实硬件验收”，且 Person Twin 不刷新，直到 iPhone 重新上传。

## 指标边界

- 当前读取：步数、静息心率、步行速度、血氧、睡眠时长。
- 步数使用 HealthKit 按天累计；睡眠时长由已睡眠阶段时长求和。
- 是否有某类样本取决于 Watch 型号、佩戴记录和授权范围。
- 不从 Apple Watch 伪造血压或体重。它们应来自真实外设、Apple 健康已有记录、手动输入或真实 Vision 服务。

## 自检

```bash
npm run typecheck
npm run test:healthkit
npm run build
npm run security:check
```

Swift 工程必须在 Mac 上以真实 iPhone 再完成一次 Build + Run 验证。

本地 Swift 编译可先执行：

```bash
cd native-ios
xcodegen generate
xcodebuild -project AnkangHealthBridge.xcodeproj -scheme AnkangHealthBridge -sdk iphoneos -configuration Debug CODE_SIGNING_ALLOWED=NO build
```

自动化无法替代真机验证：必须人工确认 observer 前台触发、锁屏/后台由 iOS 调度后的唤醒、局域网上传，以及自动刷新后的真实数值和来源。
