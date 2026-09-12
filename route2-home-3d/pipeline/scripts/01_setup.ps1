# 路线二 —— 一键环境搭建：克隆 official gaussian-splatting + 安装 Python 依赖 + 编译 CUDA 子模块
# 前置: Python(含 PyTorch+CUDA)、CUDA Toolkit(nvcc)、VS 2022 Build Tools(C++ 工作负载)
# 用法: powershell -ExecutionPolicy Bypass -File scripts\01_setup.ps1 [-AllowPtxFallback]
param(
    [switch]$AllowPtxFallback  # 未安装 CUDA 12.8 时，允许 CUDA 12.6 生成 9.0+PTX 兼容 Blackwell
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$external = "$repoRoot\pipeline\external"
$gsDir = "$external\gaussian-splatting"
$python = "$repoRoot\.venv\Scripts\python.exe"
if (-not (Test-Path $python -PathType Leaf)) {
    throw "项目虚拟环境不存在: $python。请创建 Python 3.12 的 .venv；不要使用系统 Python。"
}
New-Item -ItemType Directory -Force -Path $external | Out-Null

Write-Host "===== [1/4] 克隆官方 gaussian-splatting =====" -ForegroundColor Cyan
if (Test-Path "$gsDir\train.py") {
    Write-Host "已存在，跳过: $gsDir"
} else {
    git clone https://github.com/graphdeco-inria/gaussian-splatting.git --recursive $gsDir
    if ($LASTEXITCODE -ne 0) { throw "克隆失败，请检查网络" }
}

# 根据 PyTorch CUDA 版本和 GPU 架构选择已安装的 Toolkit，不依赖全局 CUDA_PATH。
$torchJson = & $python -c "import json, torch; print(json.dumps({'torch':torch.__version__,'cuda':torch.version.cuda,'available':torch.cuda.is_available(),'capability':list(torch.cuda.get_device_capability(0)) if torch.cuda.is_available() else None}))"
if ($LASTEXITCODE -ne 0) { throw "无法使用项目 .venv 读取 PyTorch 状态: $python" }
$torchInfo = $torchJson | ConvertFrom-Json
if (-not $torchInfo.available) { throw "项目 .venv 中 torch.cuda.is_available() = False，请先修复 PyTorch CUDA 运行时。" }

$toolkits = @(Get-ChildItem "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v*\bin\nvcc.exe" -ErrorAction SilentlyContinue | ForEach-Object {
    $cudaToolkitHome = Split-Path -Parent (Split-Path -Parent $_.FullName)
    $versionText = & $_.FullName --version 2>&1 | Out-String
    if ($versionText -match 'release\s+(\d+)\.(\d+)') {
        New-Object PSObject -Property @{ Home = $cudaToolkitHome; Nvcc = $_.FullName; Major = [int]$Matches[1]; Minor = [int]$Matches[2] }
    }
})
if ($toolkits.Count -eq 0) { throw "未找到 CUDA Toolkit (nvcc)。请安装与 PyTorch CUDA $($torchInfo.cuda) 兼容的 Toolkit。" }

$requiredMajor = [int]$torchInfo.cuda.Split('.')[0]
$requiredMinor = [int]$torchInfo.cuda.Split('.')[1]
$gpuMajor = [int]$torchInfo.capability[0]
$nativeCompatible = @($toolkits | Where-Object {
    $_.Major -eq $requiredMajor -and $_.Minor -ge $requiredMinor -and (($gpuMajor -lt 12) -or ($_.Major -gt 12) -or ($_.Major -eq 12 -and $_.Minor -ge 8))
} | Sort-Object @{ Expression = { if ($_.Minor -eq $requiredMinor) { 0 } else { 1 } } }, Minor)
$usePtxFallback = $false
if ($nativeCompatible.Count -gt 0) {
    $compatible = $nativeCompatible
}
elseif ($AllowPtxFallback -and $gpuMajor -ge 12) {
    $compatible = @($toolkits | Where-Object { $_.Major -eq 12 -and $_.Minor -ge 6 } | Sort-Object Minor -Descending)
    if ($compatible.Count -gt 0) {
        $usePtxFallback = $true
        Write-Host "警告: 未找到 CUDA 12.8；以 $($compatible[0].Major).$($compatible[0].Minor) 编译 9.0+PTX，由驱动在 Blackwell 上 JIT。此为临时兼容模式。" -ForegroundColor Yellow
    }
}
if ($compatible.Count -eq 0) {
    $installed = ($toolkits | Sort-Object Major, Minor | ForEach-Object { "$($_.Major).$($_.Minor)" }) -join ', '
    if ($gpuMajor -ge 12) {
        throw "GPU compute_$($gpuMajor)0 需要 CUDA Toolkit 12.8 或更高版本，且应与 PyTorch CUDA $($torchInfo.cuda) 匹配。当前已安装: $installed。请并行安装 CUDA Toolkit 12.8；无需删除旧版本。"
    }
    throw "没有找到与 PyTorch CUDA $($torchInfo.cuda) 兼容的 Toolkit。当前已安装: $installed。"
}
$cudaHome = $compatible[0].Home
$nvccPath = $compatible[0].Nvcc
$env:CUDA_HOME = $cudaHome
$env:CUDA_PATH = $cudaHome
$env:PATH = "$(Split-Path -Parent $nvccPath);$env:PATH"
Write-Host "CUDA_HOME = $cudaHome"
Write-Host "PyTorch   = $($torchInfo.torch) (CUDA $($torchInfo.cuda), GPU compute_$($gpuMajor)$([int]$torchInfo.capability[1]))"

$vcvars = Get-ChildItem "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat","C:\Program Files\Microsoft Visual Studio\2022\*\VC\Auxiliary\Build\vcvars64.bat" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $vcvars) { throw "未找到 vcvars64.bat，请先安装 VS 2022 Build Tools (C++ 工作负载)" }
Write-Host "vcvars64   = $($vcvars.FullName)"
$clCheck = "call `"$($vcvars.FullName)`" >nul 2>&1 && where cl >nul 2>&1"
cmd.exe /d /s /c $clCheck
if ($LASTEXITCODE -ne 0) { throw "vcvars64.bat 已找到，但初始化后仍无法定位 cl.exe: $($vcvars.FullName)" }

Write-Host "===== [2/4] 安装 3DGS + 视觉语义依赖 =====" -ForegroundColor Cyan
Push-Location $gsDir
& $python -m pip install -q plyfile tqdm --no-input
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "3DGS Python 依赖安装失败" }
Pop-Location
& $python -m pip install -q -r "$repoRoot\pipeline\semantic\requirements.txt" --no-input
if ($LASTEXITCODE -ne 0) { throw "语义识别依赖安装失败" }

Write-Host "===== [3/4] 编译 CUDA 子模块（首次约 3~10 分钟） =====" -ForegroundColor Cyan
# 在 vcvars64 环境中编译，确保 cl.exe 可用
Push-Location $gsDir
foreach ($sub in @("submodules\diff-gaussian-rasterization", "submodules\simple-knn", "submodules\fused-ssim")) {
    if (-not (Test-Path $sub)) { Write-Host "跳过不存在的子模块: $sub"; continue }
    Write-Host ">>> 编译 $sub"
    $archEnv = if ($usePtxFallback) { " && set `"TORCH_CUDA_ARCH_LIST=9.0+PTX`"" } else { "" }
    $cmd = "call `"$($vcvars.FullName)`" >nul 2>&1 && set `"CUDA_HOME=$cudaHome`" && set `"CUDA_PATH=$cudaHome`" && set `"DISTUTILS_USE_SDK=1`" && set `"TORCH_DONT_CHECK_COMPILER_ABI=1`"$archEnv && `"$python`" -m pip install --no-build-isolation .\$(($sub -replace '\\','/'))"
    cmd.exe /d /s /c $cmd
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw "编译失败: $sub" }
}
Pop-Location

Write-Host "===== [4/4] 运行时依赖验证 =====" -ForegroundColor Cyan
& $python -c "import torch; assert torch.cuda.is_available(), 'PyTorch CUDA 不可用'; import diff_gaussian_rasterization, simple_knn, fused_ssim, ultralytics; print('CUDA + 3DGS + fused SSIM + YOLO runtime ok')"
if ($LASTEXITCODE -ne 0) { throw "运行时依赖验证失败" }
Write-Host "===== 环境搭建完成 =====" -ForegroundColor Green
