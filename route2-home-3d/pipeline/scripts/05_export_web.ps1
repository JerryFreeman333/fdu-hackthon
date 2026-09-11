# 路线二 —— 导出训练结果到 Web 演示端
# 用法: powershell -ExecutionPolicy Bypass -File scripts\05_export_web.ps1 -Scene home
param([string]$Scene = "home")
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ply = Get-ChildItem "$repoRoot\pipeline\output\$Scene\point_cloud\iteration_*\point_cloud.ply" -ErrorAction SilentlyContinue |
    Sort-Object { [int]($_.Directory.Name -replace 'iteration_','') } | Select-Object -Last 1
if (-not $ply) { throw "未找到训练结果，先运行 04_train_3dgs.ps1" }

$dest = "$repoRoot\route2-home-3d\web\public\models\home.ply"
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
Copy-Item $ply.FullName $dest -Force
$iteration = [int]($ply.Directory.Name -replace 'iteration_','')
$manifest = [ordered]@{
    mode = 'real'
    scene = $Scene
    exportedAt = (Get-Date).ToUniversalTime().ToString('o')
    source = 'gaussian-splatting'
    sourcePath = $ply.FullName.Substring($repoRoot.Length + 1).Replace('\', '/')
    sha256 = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash.ToLowerInvariant()
    bytes = (Get-Item -LiteralPath $dest).Length
    iteration = $iteration
}
$manifestPath = "$repoRoot\route2-home-3d\web\public\models\home.manifest.json"
$manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding UTF8
Write-Host "===== 已导出到 $dest =====" -ForegroundColor Green
Write-Host "来源证明: $manifestPath" -ForegroundColor Green
Write-Host "下一步: 启动 web 演示 (cd route2-home-3d\web && npm run dev)，"
Write-Host "并编辑 web/public/data/hazards.json，把各条目的 realPos 从 null 改为场景内坐标完成标定。"
