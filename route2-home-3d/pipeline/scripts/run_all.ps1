# 路线二 —— Home Twin 全流程：数据准备 → COLMAP → 语义/3D 定位 → 候选路线 → 个体化通行 → Person × Home 风险 → 家庭行动 → 3DGS → Web
# 视频: powershell -ExecutionPolicy Bypass -File scripts\run_all.ps1 -Video "C:\path\home.mp4" -Scene home -PersonProfile "C:\path\person.json" -ScaleFile "C:\path\scale.json"
# 照片: powershell -ExecutionPolicy Bypass -File scripts\run_all.ps1 -Photos "C:\path\photos" -Scene home -PersonProfile "C:\path\person.json" -ScaleFile "C:\path\scale.json"
param(
    [string]$Video,
    [string]$Photos,
    [string]$Scene = "home",
    [int]$Iterations = 30000,
    [string]$PersonProfile = "",
    [string]$ScaleFile = ""
)
$ErrorActionPreference = 'Stop'
$scripts = $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($Video) -eq [string]::IsNullOrWhiteSpace($Photos)) {
    throw '必须且只能提供 -Video 或 -Photos 其中一个真实采集输入。'
}
if ($Video -and -not (Test-Path -LiteralPath $Video -PathType Leaf)) { throw "真实视频不存在: $Video" }
if ($Photos -and -not (Test-Path -LiteralPath $Photos -PathType Container)) { throw "真实照片目录不存在: $Photos" }
if ($Iterations -lt 1) { throw '-Iterations 必须大于 0。建议先用 1000 做 smoke test。' }

Write-Host "########## 路线二 · Home Twin 全流程 ##########" -ForegroundColor Cyan
& "$scripts\02_prepare_data.ps1" -Scene $Scene $(if ($Video) { "-Video"; $Video } else { "-Photos"; $Photos })
& "$scripts\03_run_colmap.ps1" -Scene $Scene
& "$scripts\06_detect_semantics.ps1" -Scene $Scene
& "$scripts\07_plan_walkable_route.ps1" -Scene $Scene

$surfaceArgs = @('-Scene', $Scene)
if ($ScaleFile) { $surfaceArgs += @('-ScaleFile', $ScaleFile) }
& "$scripts\08_build_surface_route.ps1" @surfaceArgs

if ($PersonProfile) {
    & "$scripts\09_project_person_home_risk.ps1" -Scene $Scene -PersonProfile $PersonProfile
    & "$scripts\10_build_family_action_plan.ps1" -Scene $Scene
}

& "$scripts\04_train_3dgs.ps1" -Scene $Scene -Iterations $Iterations
& "$scripts\05_export_web.ps1" -Scene $Scene
Write-Host "########## 全流程完成：3DGS + semantic Home Twin + personalized walkability + Person × Home risk + family action ##########" -ForegroundColor Green
