# Route 2 Rescan Backend

本地 FastAPI 后端只负责 **复扫输入接收、任务排队、处理状态和结果回传**。真实摄像头/深度设备不直接写入业务逻辑，而是未来实现 `CaptureSource` 接口，把照片/视频帧转换成相同的 `CaptureBatch`。

## 本地运行

```bash
cd route2-home-3d
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8010 --reload
```

Windows PowerShell：

```powershell
cd route2-home-3d
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8010 --reload
```

默认 `ROUTE2_PROCESSOR_MODE=queue`：真实媒体会经过完整上传、校验、落盘和任务状态链路，但**不会伪造新的空间风险结果**。因此上传成功不会自动关闭旧行动。

在已准备好 Windows + PowerShell + COLMAP/3DGS 环境后，可以显式启用真实 pipeline：

```powershell
$env:ROUTE2_PROCESSOR_MODE="local-pipeline"
$env:ROUTE2_ENABLE_PIPELINE="1"
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8010
```

真实 pipeline 使用 `pipeline/scripts/12_rescan_home.ps1`，结果仍经过 `person-home-risk.json` 与 `person-home-action-plan.rescan.json` 才能更新前端行动状态。

## API

`GET /api/route2/health`

返回处理器模式与硬件适配状态。

`POST /api/route2/rescan`

`multipart/form-data` 字段：`batchId`、`capturedAt`、`mediaKind`、`manifest`、`files[]`。成功返回 HTTP 202 与 `jobId`。

`GET /api/route2/rescan/{jobId}`

轮询 `queued → processing → ready/failed`；只有 `ready` 且存在新的风险投影时，前端才会应用新的风险/行动状态。任务状态会落盘到 `backend/.data/jobs/index.json`，服务重启后已结束的任务仍可查询；重启时仍在排队/处理中的任务会被如实标记为失败，请重新提交。

## 部署边界

本后端面向**本机或可信家庭内网**的单用户原型使用：

- 未做用户体系；设置环境变量 `ROUTE2_API_TOKEN`（任意随机串）后，`POST /api/route2/rescan` 与 `GET /api/route2/rescan/{jobId}` 都要求请求头 `X-Route2-Token` 匹配，否则返回 401。前端当前不发送该请求头，启用 token 时需自行在 `RESCAN_ENDPOINT` 调用侧补充。
- 单工作者队列（`max_workers=1`）；管线子进程自带超时（`ROUTE2_PIPELINE_TIMEOUT_SECONDS`，默认 1800 秒），超时任务会标记为 failed，不会永久堵死队列，但排在其后的任务仍需顺序执行。
- 请勿将端口暴露到公网。

## 隐私与留存

原始上传默认写入 `backend/.data/jobs/<jobId>/`，任务处理结束后自动删除。设置 `ROUTE2_KEEP_INPUT=1` 才保留输入供本地调试。`.data/` 永不提交到 Git。

本服务不接收 Route 1 原始聊天、原始健康事件或其他私密对话内容；Person Twin 仅通过显式配置的结构化文件提供功能状态字段。
