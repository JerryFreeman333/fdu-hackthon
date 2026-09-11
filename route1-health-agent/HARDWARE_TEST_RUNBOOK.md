# Apple Watch + iPhone 真实硬件验收

## 验收链路

```text
Apple Watch → Apple 健康 / HealthKit → iPhone companion
→ 局域网桥接服务 → HealthKitDeviceAdapter → HealthEvent
→ Detection / Finding → Person Twin
```

浏览器不会直接读取 HealthKit。真实模式不包含 Demo fallback；桥接未启动、无样本或响应来源不正确时，页面会明确报错。

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

默认监听 `0.0.0.0:8787`。现场仅在可信局域网使用；这个 MVP 服务没有账号鉴权，数据以明文 JSON 暂存在 `.healthkit-data/latest.json`，不可直接用于生产。

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

## 3. iPhone 上读取并上传

1. 桥接地址填写电脑的 `.local` 地址；测试用户 ID 保持 `现场测试用户`。
2. 点击“请求读取权限”，允许需要测试的指标。
3. 点击“读取最近 22 天”。
4. 在“最近真实样本”中核对指标、时间和 Apple 来源。
5. 点击“上传到电脑桥接服务”，必须看到电脑已接收的条数。

Apple 为保护隐私，不允许 App 区分“某项读取权限被拒绝”和“该项没有数据”。因此 companion 只显示“权限请求已完成”；最终以样本是否出现和 Apple 健康中的值人工核对。

## 4. 启动真实模式网页

复制 `.env.hardware.example` 为 `.env.local`，然后运行：

```bash
npm run dev -- --host 0.0.0.0
```

进入老人端或家属端，展开“真实硬件验收”，点击“同步真实健康数据”。

## 5. 现场通过标准

- 页面模式条显示 `设备 healthkit`。
- 调试页显示桥接状态、样本数、HealthEvent 数、Finding 数和 Person Twin 刷新日期。
- 样本 `source=healthkit`，数值和时间可与 Apple 健康人工核对。
- 样本保留 source/device/UUID；按天聚合的步数和睡眠标记聚合方法。
- 停止桥接服务后再次同步，页面明确报错，并显示“未使用 Demo 数据替代”。
- 只有将 `VITE_DEVICE_MODE` 改回 `demo` 才会恢复演示数据。

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
```

Swift 工程必须在 Mac 上以真实 iPhone 再完成一次 Build + Run 验证。
