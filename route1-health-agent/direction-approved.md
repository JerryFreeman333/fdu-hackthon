# 移动端视觉方向确认

- 展示时间：2026-09-12
- 展示版本：
  - 方向 A：参考图高还原
  - 方向 B：适老优先
  - 方向 C：比赛叙事优先
- 方向稿目录：`design-demos/`
- 对应截图：
  - `design-demos/direction-a-reference.png`
  - `design-demos/direction-b-accessible.png`
  - `design-demos/direction-c-story.png`
- 用户选择原话：`B`

## 执行方向

正式界面采用方向 B：更大字号、更高对比、更少首屏层级；语音与紧急求助作为老人端首要操作；家属端直接展示提醒原因和可执行行动。视觉继续沿用参考图的冷白淡蓝背景、低边界白卡、蓝色主操作和原生移动端结构。

实现时保留仓库既有业务逻辑、隐私门控、安全分级、HealthKit、跨设备协同、通知台账和 Route 2 行动闭环，不把方向稿中的静态演示数据写死到生产组件。
