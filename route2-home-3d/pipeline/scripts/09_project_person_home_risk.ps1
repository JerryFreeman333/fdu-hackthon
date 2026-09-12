# Route 2 —— 将 Route 1 Person Twin 与 Home Twin 组合为非诊断风险投影
param(
    [string]$Scene = "home",
    [string]$PersonProfile = "",
    [string]$HomeSnapshot = "",
    [string]$Output = ""
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$semanticDir = "$repoRoot\pipeline\data\$Scene\semantic"
$defaultPerson = "$repoRoot\pipeline\semantic\person-twin.example.json"
$defaultHome = "$semanticDir\hometwin-surface-route.json"
if (-not $PersonProfile) { $PersonProfile = $defaultPerson }
if (-not $HomeSnapshot) { $HomeSnapshot = $defaultHome }
if (-not $Output) { $Output = "$semanticDir\person-home-risk.json" }
if (-not (Test-Path $PersonProfile)) { throw "Person Twin 不存在: $PersonProfile" }
if (-not (Test-Path $HomeSnapshot)) { throw "Home Twin 不存在: $HomeSnapshot，请先运行 08_build_surface_route.ps1" }
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { throw "找不到 python" }
$args = @(
    "$repoRoot\pipeline\semantic\person_home_risk.py",
    '--person', $PersonProfile,
    '--home', $HomeSnapshot,
    '--output', $Output
)
Write-Host "===== Person Twin × Home Twin 风险投影 =====" -ForegroundColor Cyan
& $python.Source @args
if ($LASTEXITCODE -ne 0) { throw "Person × Home 风险投影失败" }
Write-Host "风险投影输出: $Output" -ForegroundColor Green
Write-Host "注意：本结果 non-diagnostic，不代表疾病诊断或现场安全认证。" -ForegroundColor Yellow
