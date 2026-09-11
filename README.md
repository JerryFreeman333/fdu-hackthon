# fdu-hackthon

复旦 hackathon 项目仓库。当前主攻 **路线一：老年健康 Agent**，另有两条备选路线的想法记录在案。

## 三条路线（详见 [docs/想法.md](docs/想法.md)）

1. **老年健康 Agent（当前主攻）** —— 整合聊天主诉、手表数据、拍照录入（血压计/体重秤/体检报告），建立"个人基线"，发现老人"和平时不一样"的变化（如心衰相关的活动耐量下降），分级通知家属。**最稳。**
2. **居家安全 3D 建模** —— 手机拍摄家庭做 Gaussian Splatting 重建，AI 分析危险点、动线、找东西，对认知障碍老人有用。**视觉冲击力最大。**
3. **融合路线（Person Twin + Home Twin）** —— Agent 看"人"，3D 看"家"，回答"这个家对现在这个老人是否安全"。**想法最完整，开发量最大。**

## 当前进展：路线一原型（可运行）

- 老人端聊天 Agent（主诉识别 + 共情回应）
- 长期健康档案（21 天趋势 + 个人基线 + 拍照录入：默认写入明确标注的 Demo 示例数据，可配置真实视觉服务，结果经确认后入库）
- 变化检测引擎（单指标偏离 + 多信号融合，内置"活动耐量下降"演示场景）
- 每周健康周报（自动生成给老人和给子女两个版本）
- 分级家属通知（平时不打扰，alert/urgent 才推送，附证据链与处理路径）

```bash
cd route1-health-agent
npm install
npm run dev
```

详细说明见 [route1-health-agent/README.md](route1-health-agent/README.md)。

## 当前进展：路线二原型（高斯泼溅建模，可运行）

`route2-home-3d/` —— 居家安全 3D 建模：手机拍摄家庭 → Gaussian Splatting 重建 → AI 分析危险点、活动动线、找东西。

- **Web 演示端（现在就能跑）**：Three.js 加载高斯模型，内置合成演示场景兜底——危险点标注（点击查看风险等级/整改建议）、动线分析（夜间起夜/日间/逃生三条路线 + 危险段红色高亮 + 自动夜间模式）、找东西（相机飞行定位物品并语音指引）
- **训练管线（一键脚本）**：视频抽帧 → COLMAP 相机标定（自动下载）→ 官方 gaussian-splatting 训练（已适配 8GB 显存）→ 导出 Web，全程 PowerShell 脚本自动化
- 手机拍摄指南见 [route2-home-3d/docs/capture-guide.md](route2-home-3d/docs/capture-guide.md)

```bash
cd route2-home-3d/web
npm install
npm run dev
```

详细说明见 [route2-home-3d/README.md](route2-home-3d/README.md)。

## 共同原则

不做"万能养老平台"；不说 AI 能诊断疾病；重点是**发现变化**和**帮助行动**；老人使用要简单（拍照、说话、自动同步）；不过度监控，只有需要时才通知家属。

## 协作约定

- 主分支 `main`，功能开发请开分支 + PR；
- 提交信息用中文或英文均可，说清"改了什么、为什么"；
- 演示数据统一放 `src/data/`，不要把真实个人健康信息提交进仓库。
