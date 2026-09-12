param([string]$PipelineRoot = "")
$ErrorActionPreference = 'Stop'
$serverRoot = Split-Path -Parent $PSScriptRoot
if (-not $PipelineRoot) { $PipelineRoot = $serverRoot }
$enginePath = (Resolve-Path -LiteralPath $PipelineRoot).Path
if (-not (Test-Path -LiteralPath "$enginePath\pipeline\external\gaussian-splatting\train.py")) { throw '指定目录缺少高斯训练代码。请传入已配置好的路线二目录。' }
$enginePython = "$enginePath\.venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $enginePython)) { throw '指定目录缺少 .venv Python。' }
& $enginePython -c "import torch; assert torch.cuda.is_available(); import diff_gaussian_rasterization, simple_knn; print('GPU training environment OK')"
if ($LASTEXITCODE -ne 0) { throw '训练环境验证失败' }
$env:ROUTE2_PIPELINE_ROOT = $enginePath
$env:ROUTE2_ENABLE_PIPELINE = '1'
Push-Location $serverRoot
try { python -m uvicorn backend.app:app --host 127.0.0.1 --port 8010 } finally { Pop-Location }
