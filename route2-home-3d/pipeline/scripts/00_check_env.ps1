# 路线二 · 居家安全 3D 建模 —— 环境检查脚本
# 用法: powershell -ExecutionPolicy Bypass -File scripts\00_check_env.ps1
$ErrorActionPreference = 'Continue'
$fail = 0
function Check($name, $ok, $detail) {
    $tag = if ($ok) { "[OK]  " } else { $fail++; "[MISS]" }
    Write-Host ("{0} {1,-28} {2}" -f $tag, $name, $detail)
}

Write-Host "===== 高斯泼溅管线环境检查 =====" -ForegroundColor Cyan

# GPU
$gpu = (nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>$null)
Check "NVIDIA GPU" ($null -ne $gpu) $(if ($gpu) { $gpu } else { "未检测到，训练需要 NVIDIA 显卡" })

# Python + torch
$pyOk = $false; $torchInfo = "未安装"
try {
    $torchInfo = python -c "import torch; print('torch ' + torch.__version__ + ' / cuda ' + str(torch.version.cuda) + ' / available=' + str(torch.cuda.is_available()))" 2>$null
    $pyOk = ($LASTEXITCODE -eq 0)
} catch {}
$pyVer = (python --version 2>$null)
Check "Python" ($null -ne $pyVer) $pyVer
Check "PyTorch + CUDA" $pyOk $torchInfo

# nvcc（CUDA Toolkit）
$nvcc = Get-Command nvcc -ErrorAction SilentlyContinue
if (-not $nvcc) {
    $nvccPath = Get-ChildItem "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\*\bin\nvcc.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($nvccPath) { $nvcc = @{ Source = $nvccPath.FullName } }
}
Check "CUDA Toolkit (nvcc)" ($null -ne $nvcc) $(if ($nvcc) { $nvcc.Source } else { "编译 CUDA 子模块必需，可用 winget install Nvidia.CUDA --version 12.6" })

# VS C++ 编译器
$cl = Get-ChildItem "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\*\bin\Hostx64\x64\cl.exe","C:\Program Files\Microsoft Visual Studio\2022\*\VC\Tools\MSVC\*\bin\Hostx64\x64\cl.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
Check "MSVC 编译器 (cl.exe)" ($null -ne $cl) $(if ($cl) { $cl.FullName } else { "编译 CUDA 子模块必需，安装 VS 2022 Build Tools + C++ 工作负载" })

# ffmpeg
$ff = Get-Command ffmpeg -ErrorAction SilentlyContinue
Check "ffmpeg（视频抽帧）" ($null -ne $ff) $(if ($ff) { (ffmpeg -version 2>$null | Select-Object -First 1).Split(' ')[2] } else { "仅当用视频采集时需要，winget install ffmpeg" })

# COLMAP（本地 external 目录或 PATH）
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$colmapLocal = Get-ChildItem "$repoRoot\pipeline\external\colmap*\colmap.bat","$repoRoot\pipeline\external\colmap*\colmap.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
$colmapPath = Get-Command colmap -ErrorAction SilentlyContinue
Check "COLMAP（相机标定）" (($null -ne $colmapLocal) -or ($null -ne $colmapPath)) $(if ($colmapLocal) { $colmapLocal.FullName } elseif ($colmapPath) { $colmapPath.Source } else { "脚本 03 会自动下载" })

# 官方 gaussian-splatting 仓库
$gsDir = "$repoRoot\pipeline\external\gaussian-splatting"
Check "gaussian-splatting 仓库" (Test-Path "$gsDir\train.py") $(if (Test-Path "$gsDir\train.py") { $gsDir } else { "运行 01_setup.ps1 自动克隆并编译" })

# 子模块编译产物
if (Test-Path "$gsDir\train.py") {
    $sub = python -c "import diff_gaussian_rasterization, simple_knn; print('已安装')" 2>$null
    Check "diff-gaussian-rasterization / simple-knn" ($LASTEXITCODE -eq 0) $sub
}

Write-Host ""
if ($fail -eq 0) { Write-Host ">>> 环境就绪，可以运行 run_all.ps1" -ForegroundColor Green }
else { Write-Host ">>> 缺少 $fail 项依赖，请按上方提示安装后重试" -ForegroundColor Yellow }
exit $fail