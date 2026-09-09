# 路线二：居家安全 3D / Home Twin 原型

> 当前阶段的目标不是“做一个漂亮的 3D 房子”，而是把家庭空间变成可查询、可定位、可追溯的 Home Twin 基础数据，为后续 Person × Home 风险判断提供输入。

## 当前真实能力边界

本目录目前包含两条能力链：

1. **合成演示链**：用于比赛演示，场景中的危险点、动线和物品来自预置数据，不代表系统已经自动识别真实家庭。
2. **真实重建链**：手机拍摄 → COLMAP → Gaussian Splatting → Web 加载真实 3D 模型。真实模型中的危险点、路线和物品目前仍需要空间标定；未标定的数据不会被 Web 端伪造成已知结果。

因此当前版本应称为“Home Twin 原型”，而不是“已经自动理解家庭的 AI 系统”。

## 目录

```text
route2-home-3d/
├── docs/capture-guide.md
├── pipeline/
│   └── scripts/
│       ├── 00_check_env.ps1
│       ├── 01_setup.ps1
│       ├── 02_prepare_data.ps1
│       ├── 03_run_colmap.ps1
│       ├── 04_train_3dgs.ps1
│       ├── 05_export_web.ps1
│       └── run_all.ps1
└── web/
    ├── public/data/hazards.json
    └── src/
        ├── hometwin/model.ts
        ├── hometwin/fromHazardData.ts
        ├── scene/
        └── ui/
```

## Web 演示

```powershell
cd route2-home-3d/web
npm ci
npm test
npm run build
npm run dev
```

没有 `public/models/home.ply` 时，网页自动进入合成演示模式；此模式只用于验证交互，不用于证明真实空间识别准确率。

有真实 `home.ply` 时，进入真实重建模式。此时只有已经完成 `realPos` / `realPoints` 标定的数据才会进入交互；未标定结果会显示为“尚未完成真实空间标定”。

## 真实 3D 重建管线

### 环境

- Windows + NVIDIA GPU
- Python 3.10+
- 与本机 CUDA/驱动匹配的 PyTorch
- CUDA Toolkit / `nvcc`
- Visual Studio 2022 Build Tools + C++ 工作负载
- ffmpeg

先执行：

```powershell
cd route2-home-3d/pipeline/scripts
powershell -ExecutionPolicy Bypass -File 00_check_env.ps1
powershell -ExecutionPolicy Bypass -File 01_setup.ps1
```

之后运行：

```powershell
powershell -ExecutionPolicy Bypass -File run_all.ps1 -Video "C:\path\home.mp4" -Scene home
```

也支持照片目录：

```powershell
powershell -ExecutionPolicy Bypass -File run_all.ps1 -Photos "C:\path\photos" -Scene home
```

每次数据准备都会清理该 `Scene` 的旧输入、COLMAP 数据库和中间结果，避免重复扫描相互污染。

## 真实模型标定

训练结束以后，当前版本仍需要人工把真实模型中的关键数据与坐标对应起来：

- `hazards[].realPos`
- `paths[].realPoints`
- `items[].realPos`

这是**显式的人机校正步骤**，不是自动识别。该步骤的存在是刻意的：黑客松阶段宁可让人确认关键空间数据，也不应把低可信的视觉结果伪装成确定事实。

## Home Twin 数据契约

`web/src/hometwin/model.ts` 定义了后续统一使用的数据结构：

- `HomeRoom`：房间及功能标签
- `HomeObject`：物体、位置、所属房间、来源、时间、置信度
- `SpatialRelation`：对象之间的空间关系
- `HomeRoute`：高价值生活路线及风险点
- `HomeTwinSnapshot`：家庭版本、采集时间、尺度可信度和上述数据的统一快照

下一阶段应把视觉识别输出转换成这个结构，而不是继续把新功能直接塞进 `hazards.json`。

## 当前明确不做的事情

- 不把 Gaussian Splatting 本身当成“AI 理解”
- 不把预置危险点当成真实视觉检测结果
- 不把 Catmull-Rom 曲线当成真正的最优/安全路径规划算法
- 不把 3DGS 输出当成厘米级测量结果
- 不在未标定时给出确定的真实位置
- 不在路线二内部直接做 Person Twin 的个体化健康诊断

## 下一阶段优先级

### P0

真实模型语义识别 → 关键物体定位 → 房间/物体/通道关系 → Bed → Toilet 结构化路线。

### P1

环境变化检测、Home Twin 版本管理、人工校正、置信度和质量报告。

### P2

与 Route 1 Person Twin / Risk Engine 对接，形成 Person × Home 的个性化风险判断。

## 隐私

拍摄素材、COLMAP 中间数据、训练产物和模型文件默认不入库；卫生间等高度敏感区域应尽量减少拍摄范围。真实产品版本还需要进一步加入家庭空间访问授权、分享控制、删除和审计机制；这些能力尚未在当前原型中完成。