# 路线二：居家安全 3D 建模（Gaussian Splatting）

> 把老人家里变成一个可以被 AI 理解的 3D 空间：帮他找危险、找路线、找东西。
> 对应 `docs/想法.md` 中的路线二，也是融合路线（路线三）中"Home Twin"的基础。

## 组成

```
route2-home-3d/
├── docs/capture-guide.md    手机拍摄指南（先看这个）
├── pipeline/
│   ├── scripts/
│   │   ├── 00_check_env.ps1    环境检查
│   │   ├── 01_setup.ps1        克隆官方 gaussian-splatting + 编译 CUDA 子模块
│   │   ├── 02_prepare_data.ps1 视频抽帧 / 照片整理
│   │   ├── 03_run_colmap.ps1   COLMAP 相机标定（自动下载）
│   │   ├── 04_train_3dgs.ps1   高斯泼溅训练（8GB 显存适配）
│   │   ├── 05_export_web.ps1   导出模型到 Web 演示端
│   │   └── run_all.ps1         一键全流程
│   ├── data/      拍摄素材与 COLMAP 中间结果（不入库）
│   ├── output/    训练产物（不入库）
│   └── external/  gaussian-splatting、COLMAP（不入库）
└── web/                     Web 演示端（Vite + Three.js）
    ├── public/models/       home.ply 放这里（真实模型）
    ├── public/data/hazards.json   危险点 / 动线 / 物品数据
    └── src/                 viewer、合成演示场景、标注、动线、找东西
```

## 快速开始：Web 演示端（无需训练）

```powershell
cd route2-home-3d/web
npm install
npm run dev      # 打开 http://localhost:5174
```

没有真实模型时自动进入**合成演示场景**（一套虚拟的"卧室+走廊+客厅+卫生间"），
完整演示三大功能：

- **安全巡检** —— 场景中标记危险点（地毯翘边、电线横穿、台阶无扶手、湿滑、照明不足…），
  点击查看风险等级、位置、风险描述与整改建议；右侧面板显示风险统计。
- **动线分析** —— 三条动线（夜间起夜 / 日间活动 / 紧急逃生），
  发光路径 + 沿线行走动画 + 危险段红色高亮；夜间动线会自动切换夜间环境。
- **找东西** —— 一键定位老花镜 / 降压药 / 钥匙，相机飞到物品处并给出语音式指引文案
  （对认知障碍老人场景的直接演示）。

训练完成后把 `home.ply` 放进 `web/public/models/`，刷新即为**真实重建模式**。

## 训练真实模型（需要一次性环境配置）

### 环境要求

- NVIDIA GPU（8GB 显存已验证可行，推荐 RTX 40 系）
- Python 3.10+，且安装了匹配 CUDA 的 PyTorch（`pip install torch --index-url https://download.pytorch.org/whl/cu126`）
- CUDA Toolkit 12.6（`winget install Nvidia.CUDA --version 12.6`，编译 CUDA 子模块必需）
- VS 2022 Build Tools + "使用 C++ 的桌面开发"工作负载
  （`winget install Microsoft.VisualStudio.2022.BuildTools` 后在 Visual Studio Installer 里勾选）
- ffmpeg（`winget install ffmpeg`，视频采集方式需要）

### 一键流程

```powershell
cd route2-home-3d/pipeline/scripts

# 0. 环境自检（哪项缺了会明确提示）
powershell -ExecutionPolicy Bypass -File 00_check_env.ps1

# 1. 首次：克隆官方仓库并编译（约 3~10 分钟）
powershell -ExecutionPolicy Bypass -File 01_setup.ps1

# 2. 拍好后：一键 数据准备 → COLMAP → 训练 → 导出到 Web
powershell -ExecutionPolicy Bypass -File run_all.ps1 -Video "C:\path\home.mp4" -Scene home
# 或用照片: run_all.ps1 -Photos "C:\path\photos" -Scene home
```

RTX 4060 8GB 训练 30000 步约 20~50 分钟。想快速预览用
`04_train_3dgs.ps1 -Iterations 7000`；OOM 时加 `-Downscale 4`。

### 标注真实模型的危险点

训练导出后，在 three.js 里对照模型把 `web/public/data/hazards.json`
中各条目的 `realPos` 从 `null` 改为场景内坐标（单位：米），
同时可把动线的 `realPoints` 依次填上途经点。`demoPos` 只用于合成演示场景。

## 隐私说明

- 拍摄素材、COLMAP 中间数据、训练产物、模型文件全部在 `.gitignore` 中，**不提交仓库**；
- Web 演示端全部本地运行，不上传任何影像；
- 卫生间等隐私区域拍摄建议只拍门口（见拍摄指南）。