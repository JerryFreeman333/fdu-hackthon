# 路线二 —— 一键环境搭建：克隆官方 gaussian-splatting + 安装 Python 依赖 + 编译 CUDA 子模块
# 前置: Python(含 PyTorch+CUDA)、CUDA Toolkit(nvcc)、VS 2022 Build Tools(C++ 工作负载)
# 用法: powershell -ExecutionPolicy Bypass -File scripts\01_setup.ps1
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$external = "$repoRoot\pipeline\external"
$gsDir = "$external\gaussian-splatting"
New-Item -ItemType Directory -Force -Path $external | Out-Null

Write-Host "===== [1/3] 克隆官方 gaussian-splatting =====" -ForegroundColor Cyan
if (Test-Path "$gsDir\train.py") {
    Write-Host "已存在，跳过: $gsDir"
} else {
    git clone https://github.com/graphdeco-inria/gaussian-splatting.git --recursive $gsDir
    if ($LASTEXITCODE -ne 0) { throw "克隆失败，请检查网络" }
}

# 定位 nvcc 与 vcvars
$nvcc = Get-Command nvcc -ErrorAction SilentlyContinue
if (-not $nvcc) {
    $nvcc = Get-ChildItem "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\*\bin\nvcc.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($nvcc) { $env:PATH = "$($nvcc.DirectoryName);$env:PATH"; $nvcc = Get-Command nvcc }
}
if (-not $nvcc) { throw "未找到 nvcc，请先安装 CUDA Toolkit 12.6: winget install Nvidia.CUDA --version 12.6" }
$cudaHome = Split-Path -Parent (Split-Path -Parent $nvcc.Source)
$env:CUDA_HOME = $cudaHome
$env:CUDA_PATH = $cudaHome
Write-Host "CUDA_HOME = $cudaHome"

$vcvars = Get-ChildItem "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat","C:\Program Files\Microsoft Visual Studio\2022\*\VC\Auxiliary\Build\vcvars64.bat" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $vcvars) { throw "未找到 vcvars64.bat，请先安装 VS 2022 Build Tools (C++ 工作负载)" }
Write-Host "vcvars64   = $($vcvars.FullName)"

Write-Host "===== [2/3] 安装 Python 依赖 =====" -ForegroundColor Cyan
Push-Location $gsDir
pip install -q plyfile tqdm torch torchaudio --no-input
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "pip 依赖安装失败" }

Write-Host "===== [3/3] 编译 CUDA 子模块（首次约 3~10 分钟） =====" -ForegroundColor Cyan
# 在 vcvars64 环境中编译，确保 cl.exe 可用
foreach ($sub in @("submodules\diff-gaussian-rasterization", "submodules\simple-knn", "submodules\fused-ssim")) {
    if (-not (Test-Path $sub)) { Write-Host "跳过不存在的子模块: $sub"; continue }
    Write-Host ">>> 编译 $sub"
    $cmd = "call `"$($vcvars.FullName)`" >nul 2>&1 && set CUDA_HOME=$cudaHome&& set CUDA_PATH=$cudaHome&& set DISTUTILS_USE_SDK=1&& python -m pip install .\$(($sub -replace '\\','/'))"
    cmd /c $cmd
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw "编译失败: $sub" }
}
Pop-Location

python -c "import diff_gaussian_rasterization, simple_knn; print('CUDA 子模块安装成功')" 
if ($LASTEXITCODE -ne 0) { throw "子模块导入验证失败" }
Write-Host "===== 环境搭建完成 =====" -ForegroundColor Green