# 路线二 —— 高斯泼溅训练（官方实现，8GB 显存适配）
# 用法: powershell -ExecutionPolicy Bypass -File scripts\04_train_3dgs.ps1 -Scene home [-Iterations 30000] [-Downscale 4]
param(
    [string]$Scene = "home",
    [int]$Iterations = 30000,   # 快速预览可用 7000
    [int]$Downscale = 0         # 0=自动(宽>1600 时降 2 倍)；OOM 时手动设 4
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$gsDir = "$repoRoot\pipeline\external\gaussian-splatting"
$distilled = "$repoRoot\pipeline\data\$Scene\distilled"
$output = "$repoRoot\pipeline\output\$Scene"
if (-not (Test-Path "$distilled\sparse")) { throw "COLMAP 结果不存在: $distilled，先运行 03_run_colmap.ps1" }
if (-not (Test-Path "$gsDir\train.py")) { throw "官方仓库未就绪，先运行 01_setup.ps1" }

$args = @("train.py", "-s", $distilled, "-m", $output, "--iterations", $Iterations, "--test_iterations", "7000", "30000")
if ($Downscale -gt 0) { $args += @("-r", "$Downscale") }

Write-Host "===== 训练高斯泼溅模型 (iterations=$Iterations) =====" -ForegroundColor Cyan
Write-Host "提示: RTX 4060 8GB 约需 20~50 分钟；如遇 OOM 请加 -Downscale 4" -ForegroundColor Yellow
Push-Location $gsDir
python @args
Pop-Location
if ($LASTEXITCODE -ne 0) { throw "训练失败" }

$ply = Get-ChildItem "$output\point_cloud\iteration_*\point_cloud.ply" | Sort-Object { [int]($_.Directory.Name -replace 'iteration_','') } | Select-Object -Last 1
Write-Host "===== 训练完成: $($ply.FullName) =====" -ForegroundColor Green