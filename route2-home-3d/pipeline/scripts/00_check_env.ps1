# 路线二 · 居家安全 3D 建模 —— 环境检查脚本
# 用法: powershell -ExecutionPolicy Bypass -File scripts\00_check_env.ps1
$ErrorActionPreference = 'Continue'
$script:fail = 0
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$python = "$repoRoot\.venv\Scripts\python.exe"
function Check($name, $ok, $detail) {
    if (-not $ok) { $script:fail++ }
    $tag = if ($ok) { "[OK]  " } else { "[MISS]" }
    Write-Host ("{0} {1,-28} {2}" -f $tag, $name, $detail)
}

Write-Host "===== 高斯泼溅管线环境检查 =====" -ForegroundColor Cyan

$gpu = (nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>$null)
Check "NVIDIA GPU" ($null -ne $gpu -and $gpu) $(if ($gpu) { $gpu } else { "未检测到，训练需要 NVIDIA 显卡" })

$pyVer = if (Test-Path $python -PathType Leaf) { & $python --version 2>$null } else { $null }
Check "项目 Python (.venv)" ($null -ne $pyVer) $(if ($pyVer) { "$pyVer; $python" } else { "未找到 $python" })

$torchInfo = "未安装"
$torchOk = $false
try {
    $torchInfo = & $python -c "import torch; print('torch=' + torch.__version__ + '; cuda_build=' + str(torch.version.cuda) + '; cuda_available=' + str(torch.cuda.is_available())); raise SystemExit(0 if torch.cuda.is_available() else 2)" 2>&1
    $torchOk = ($LASTEXITCODE -eq 0)
} catch {}
Check "PyTorch + CUDA" $torchOk $torchInfo

$nvcc = Get-Command nvcc -ErrorAction SilentlyContinue
if (-not $nvcc) {
    $nvccPath = Get-ChildItem "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\*\bin\nvcc.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($nvccPath) { $nvcc = @{ Source = $nvccPath.FullName } }
}
Check "CUDA Toolkit (nvcc)" ($null -ne $nvcc) $(if ($nvcc) { $nvcc.Source } else { "编译 CUDA 子模块必需" })

$cl = Get-ChildItem "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\*\bin\Hostx64\x64\cl.exe","C:\Program Files\Microsoft Visual Studio\2022\*\VC\Tools\MSVC\*\bin\Hostx64\x64\cl.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
Check "MSVC 编译器 (cl.exe)" ($null -ne $cl) $(if ($cl) { $cl.FullName } else { "编译 CUDA 子模块必需" })

$ff = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ff) {
    $ff = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Gyan.FFmpeg_*\*\bin\ffmpeg.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
}
$ffmpegPath = if ($ff) { if ($ff.PSObject.Properties['Source']) { $ff.Source } else { $ff.FullName } }
Check "ffmpeg（视频抽帧）" ($null -ne $ff) $(if ($ff) { (& $ffmpegPath -version 2>$null | Select-Object -First 1) } else { "仅视频采集需要" })

$ultra = & $python -c "import ultralytics; print('ultralytics ' + ultralytics.__version__)" 2>&1
Check "Ultralytics（语义检测）" ($LASTEXITCODE -eq 0) $ultra

$colmapLocal = Get-ChildItem "$repoRoot\pipeline\external\colmap*\colmap.bat","$repoRoot\pipeline\external\colmap*\colmap.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
$colmapPath = Get-Command colmap -ErrorAction SilentlyContinue
Check "COLMAP（相机标定）" (($null -ne $colmapLocal) -or ($null -ne $colmapPath)) $(if ($colmapLocal) { $colmapLocal.FullName } elseif ($colmapPath) { $colmapPath.Source } else { "脚本 03 会自动下载" })

$gsDir = "$repoRoot\pipeline\external\gaussian-splatting"
Check "gaussian-splatting 仓库" (Test-Path "$gsDir\train.py") $(if (Test-Path "$gsDir\train.py") { $gsDir } else { "运行 01_setup.ps1 自动克隆并编译" })

if (Test-Path "$gsDir\train.py") {
    $sub = & $python -c "import diff_gaussian_rasterization, simple_knn, fused_ssim; print('已安装')" 2>&1
    Check "3DGS CUDA 子模块" ($LASTEXITCODE -eq 0) $sub
}

Write-Host ""
if ($fail -eq 0) { Write-Host ">>> 环境就绪，可以运行 run_all.ps1" -ForegroundColor Green }
else { Write-Host ">>> 缺少 $fail 项依赖，请按上方提示处理" -ForegroundColor Yellow }
exit $fail
