# 家庭空间拍摄与建模

网页 `/` 现在进入真实空间建立流程，旧示例通过 `/?demo=1` 显式访问。
路线一“家庭空间”进入同一页面。

创建空间 → 摄像头权限 → 引导录像 → 暂停/继续/回看/重拍 → 上传 → 抽帧 → COLMAP → 高斯训练 → 本任务 PLY → 网页模型浏览。
文件选择作为无法在浏览器打开摄像头时的入口。当前一次提交一个连续视频，200 MB 上限。

## 本地启动

在 route2-home-3d 目录执行 `python -m uvicorn backend.app:app --host 127.0.0.1 --port 8010`。
在 web 目录执行 `npm run dev -- --host 127.0.0.1`，打开 http://127.0.0.1:5174/ 。
默认保留上传，状态 waiting_worker；不把接收文件当成模型完成。

在已经配好 COLMAP、Python/CUDA 和 gaussian-splatting 的环境启动后端前设置：

```powershell
$env:ROUTE2_ENABLE_PIPELINE = '1'
# 可选：已配置完成的路线二根目录（包含 pipeline/scripts、pipeline/external）
$env:ROUTE2_PIPELINE_ROOT = 'D:\your-configured-route2'
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8010
```

工作进程逐步执行 02_prepare_data、03_run_colmap、04_train_3dgs；任何一步返回非零即失败。
不调用复扫脚本，因为首次建家不应依赖旧风险计划。
训练结果从 pipeline/output/{jobId} 查找并复制到任务自己的存储，不覆盖示例模型。
每次重试创建新的训练输出目录。

房间外观模型发布后，才尝试视觉语义阶段（06_detect_semantics）。该阶段只在 Windows + 可用 NVIDIA 显卡时运行，并把本次任务编号与拍摄时间传给脚本。拍摄时间在上传被接受时写入任务，重试沿用同一时间，避免把旧视频说成新拍摄；非 Windows、无显卡或识别失败只会让 `semanticStatus=failed/unavailable`，不会撤回已生成的 PLY 模型，也不会伪造物品坐标。语义结果必须同时满足：来源为视觉检测、类别属于六类、带画面证据、坐标有限且声明为 `colmap-arbitrary`、`homeId/capturedAt` 与本次拍摄一致、尺度置信度为 0；否则整份结果拒绝导入。

## 接口

- POST /api/route2/homes：建立空间，返回 homeId。
- GET /api/route2/homes/{homeId}：恢复状态、任务阶段、`capturedAt`、`modelReady`、`modelUrl`、`semanticReady`、`semanticStatus`、`semanticMessage`、`semanticUrl`。`modelUrl` 只对应房间外观 PLY；语义结果不会伪装成外观模型。旧状态缺少 `modelReady` 但已有可用 PLY 时按已就绪处理。
- POST /api/route2/homes/{homeId}/capture：multipart file 视频，返回 202。
- POST /api/route2/homes/{homeId}/retry：对保留的视频重新处理；已就绪但模型文件缺失时也会重新排队。
- GET /api/route2/homes/{homeId}/model.ply：仅 ready 且模型文件存在时提供对应模型。
- GET /api/route2/homes/{homeId}/semantic.json：仅通过上述校验的语义快照；未生成或被拒绝时返回 409。

JSON 状态和媒体保存在 backend/.data/homes，可通过 ROUTE2_HOME_DATA_ROOT 更改。
处理中的任务遇到后端重启，会显示中断并允许重试；视频不随任务结束删除。
当前为本机单家庭开发流程，homeId 存在浏览器本地；没有声称已完成登录鉴权或多账号隔离。正式云端上线前应对家庭归属鉴权、配额、保留期限做配套接入。
手机实时拍摄要求 HTTPS 或受信任环境；普通局域网 HTTP 可使用手机相机先录像再选文件。

## 验证与剩余工作

`python -m unittest backend.test_home_capture` 覆盖上传保留、空间隔离、等待服务、重试、阶段调用、按任务发布模型及中断恢复。训练过程使用测试替身。
网页使用真实 getUserMedia + MediaRecorder，模型使用现有 GaussianSplats3D 查看器。
本机已找到训练环境 `C:\HomeTwinDev\fdu-hackthon\route2-home-3d`，验证 PyTorch 2.11.0+cu128、CUDA 和高斯训练模块导入成功。新后端通过 ROUTE2_PIPELINE_ROOT 连接该环境，尚未用用户新拍的房间视频完成 GPU 训练验收。
可在新工作目录运行 `./backend/start-home-capture.ps1 -PipelineRoot C:/HomeTwinDev/fdu-hackthon/route2-home-3d` 恢复此连接。
本机（macOS）只能验证能力探测、状态机和诚实降级；真实视觉语义识别仍需 Windows + NVIDIA 建模机验收。
即使语义阶段成功，物品标注、药品绑定、可行走路线和风险结论仍不能自动等于现场安全，路线与风险仍需人工确认。
