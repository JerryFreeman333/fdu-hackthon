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

## 接口

- POST /api/route2/homes：建立空间，返回 homeId。
- GET /api/route2/homes/{homeId}：恢复状态、任务阶段、modelUrl。
- POST /api/route2/homes/{homeId}/capture：multipart file 视频，返回 202。
- POST /api/route2/homes/{homeId}/retry：对保留的视频重新处理。
- GET /api/route2/homes/{homeId}/model.ply：仅 ready 时提供对应模型。

JSON 状态和媒体保存在 backend/.data/homes，可通过 ROUTE2_HOME_DATA_ROOT 更改。
处理中的任务遇到后端重启，会显示中断并允许重试；视频不随任务结束删除。
当前为本机单家庭开发流程，homeId 存在浏览器本地；没有声称已完成登录鉴权或多账号隔离。正式云端上线前应对家庭归属鉴权、配额、保留期限做配套接入。
手机实时拍摄要求 HTTPS 或受信任环境；普通局域网 HTTP 可使用手机相机先录像再选文件。

## 验证与剩余工作

`python -m unittest backend.test_home_capture` 覆盖上传保留、空间隔离、等待服务、重试、阶段调用、按任务发布模型及中断恢复。训练过程使用测试替身。
网页使用真实 getUserMedia + MediaRecorder，模型使用现有 GaussianSplats3D 查看器。
本机已找到训练环境 `C:\HomeTwinDev\fdu-hackthon\route2-home-3d`，验证 PyTorch 2.11.0+cu128、CUDA 和高斯训练模块导入成功。新后端通过 ROUTE2_PIPELINE_ROOT 连接该环境，尚未用用户新拍的房间视频完成 GPU 训练验收。
可在新工作目录运行 `./backend/start-home-capture.ps1 -PipelineRoot C:/HomeTwinDev/fdu-hackthon/route2-home-3d` 恢复此连接。
物品标注、药品绑定和可行走路线仍需空间语义/定位的下一阶段，生成高斯模型不自动等于可导航地图。
