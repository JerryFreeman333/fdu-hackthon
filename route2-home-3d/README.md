# 路线二：居家安全 3D / Home Twin 原型

> 当前阶段的目标不是“做一个漂亮的 3D 房子”，而是把家庭空间变成可查询、可定位、可追溯的 Home Twin 基础数据，为后续 Person × Home 风险判断提供输入。

## 当前真实能力边界

本目录目前包含三层能力：

1. **合成演示链**：场景中的危险点、动线和物品来自预置数据，只用于验证交互。
2. **真实重建链**：手机拍摄 → COLMAP → Gaussian Splatting → Web 加载真实 3D 模型。
3. **真实语义定位链**：输入图像 → YOLO-World 六类开放词汇检测 → COLMAP 2D track → 3D anchor → `HomeTwinSnapshot`。只有获得足够稀疏重建支持的对象才会拥有 3D 坐标。

因此当前版本仍应称为“Home Twin 原型”，不宣称已经完成老人家庭环境的高精度自动理解。

## 目录

```text
route2-home-3d/
├── docs/capture-guide.md
├── pipeline/
│   ├── semantic/
│   │   ├── requirements.txt
│   │   ├── README.md
│   │   └── detect_and_localize.py
│   └── scripts/
│       ├── 00_check_env.ps1
│       ├── 01_setup.ps1
│       ├── 02_prepare_data.ps1
│       ├── 03_run_colmap.ps1
│       ├── 04_train_3dgs.ps1
│       ├── 05_export_web.ps1
│       ├── 06_detect_semantics.ps1
│       └── run_all.ps1
└── web/
    ├── public/data/hazards.json
    ├── public/data/semantic-targets.json
    └── src/
        ├── hometwin/model.ts
        ├── hometwin/semantic.ts
        ├── hometwin/importSemantic.ts
        ├── hometwin/routePlanner.ts
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

有真实 `home.ply` 时，进入真实重建模式。未完成真实空间定位的数据不会被 Web 端伪造成已知结果。

## 真实 3D + 语义定位管线

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

之后运行完整管线：

```powershell
powershell -ExecutionPolicy Bypass -File run_all.ps1 -Video "C:\path\home.mp4" -Scene home
```

也支持照片目录：

```powershell
powershell -ExecutionPolicy Bypass -File run_all.ps1 -Photos "C:\path\photos" -Scene home
```

完整流程现在是：

`照片/视频 → 数据准备 → COLMAP → YOLO-World 六类语义检测 → COLMAP 3D anchor → Gaussian Splatting → Web 导出`

也可以单独运行语义层：

```powershell
powershell -ExecutionPolicy Bypass -File 06_detect_semantics.ps1 -Scene home
```

输出：

`pipeline/data/<Scene>/semantic/hometwin-semantic.json`

### 六类核心对象

第一版只固定六类，避免开放词汇结果无限扩散：

- `bed` 床
- `door` 门/出入口
- `rug` 地毯
- `cable` 地面电线
- `threshold` 门槛/台阶
- `toilet` 卫生间/马桶区域

### 为什么先采用“2D 检测 + COLMAP track → 3D anchor”

当前阶段最需要的是把视觉证据和三维坐标建立可靠连接，而不是立即做复杂的端到端 3D 语义模型。检测框中的 COLMAP 稀疏轨迹可以作为第一版可审计的 3D 支撑；没有轨迹支持时，系统保持“未定位”。

### 尺度限制

当前 `scaleConfidence = 0`。COLMAP SfM 输出的是重建坐标系，并不能自动保证绝对米制尺度。因此现在可以比较同一场景内对象的相对位置，但**不能把坐标差直接解释为多少米**。后续必须增加实测标尺/已知尺寸锚点，再把尺度置信度写入 Home Twin。

## Home Twin 数据契约

`web/src/hometwin/model.ts` 统一承载：

- `HomeRoom`：房间及功能标签
- `HomeObject`：物体、位置、所属房间、来源、时间、置信度
- `SpatialRelation`：对象之间的空间关系
- `HomeRoute`：高价值生活路线及风险点
- `HomeTwinSnapshot`：家庭版本、采集时间、尺度可信度和上述数据的统一快照

语义感知层输出的对象可以进入这个契约，但不会自动伪造 `connects / blocks / on-route` 关系；路线规划只有在具备足够空间关系证据时才允许执行。

## 当前仍未完成

- 房间自动分区与门/通道拓扑
- 视觉对象的稳定跨帧 ID
- 从 3D 对象自动推导可靠的 `connects / blocks / on-route`
- 真正米制尺度标定
- 安全路线而不仅是几何最短路线
- 环境变化检测
- Person × Home 个体化风险计算
- 面向老人和家属的最终产品 UI

这些属于下一阶段，而不是用静态数据假装已经完成。

## 隐私

拍摄素材、COLMAP 中间数据、训练产物和模型文件默认不入库；卫生间等高度敏感区域应尽量减少拍摄范围。真实产品版本还需要家庭空间访问授权、分享控制、删除和审计机制；这些能力尚未在当前原型中完成。
