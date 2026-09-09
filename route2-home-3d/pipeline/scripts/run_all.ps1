# 路线二 —— 一键全流程：数据准备 → COLMAP → 视觉语义/3D 定位 → 候选拓扑 → 语义可通行候选 → 表面代价图 → 个体化通行 → Person × Home 风险 → 3DGS → 导出 Web
# 用法1(视频): powershell -ExecutionPolicy Bypass -File scripts\run_all.ps1 -Video "C:\path\home.mp4" -Scene home -PersonProfile "C:\path\person.json" -ScaleFile "C:\path\scale.json"
# 用法2(照片): powershell -ExecutionPolicy Bypass -File scripts\run_all.ps1 -Photos "C:\path\photos" -Scene home -PersonProfile "C:\path\person.json" -ScaleFile "C:\path\scale.json"
param(
    [string]$Video,
    [string]$Photos,
    [string]$Scene = "home",
    [int]$Iterations = 30000,
    [string]$PersonProfile = "",
    [string]$ScaleFile = "",
    [string]$MobilityProfile = ""
)
$ErrorActionPreference = 'Stop'
$scripts = $PSScriptRoot

Write-Host "########## 路线二 · Home Twin 全流程 ##########" -ForegroundColor Cyan
& "$scripts\02_prepare_data.ps1" -Scene $Scene $(if ($Video) { "-Video"; $Video } else { "-Photos"; $Photos })
& "$scripts\03_run_colmap.ps1" -Scene $Scene
& "$scripts\06_detect_semantics.ps1" -Scene $Scene
& "$scripts\07_plan_walkable_route.ps1" -Scene $Scene

$surfaceArgs = @('-Scene', $Scene)
if ($ScaleFile) { $surfaceArgs += @('-ScaleFile', $ScaleFile) }
& "$scripts\08_build_surface_route.ps1" @surfaceArgs

if ($PersonProfile -or $MobilityProfile) {
    if (-not $PersonProfile) { $PersonProfile = "$repoRoot\pipeline\semantic\person-twin.example.json" }
    $riskArgs = @('-Scene', $Scene, '-PersonProfile', $PersonProfile)
    & "$scripts\09_project_person_home_risk.ps1" @riskArgs
}

& "$scripts\04_train_3dgs.ps1" -Scene $Scene -Iterations $Iterations
& "$scripts\05_export_web.ps1" -Scene $Scene
Write-Host "########## 全流程完成：3DGS + semantic Home Twin + personalized walkability + Person × Home risk candidate ##########" -ForegroundColor Green
