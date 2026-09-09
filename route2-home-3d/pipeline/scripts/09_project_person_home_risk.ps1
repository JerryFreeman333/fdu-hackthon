# Route 2 —— Person Twin × Home Twin 个体化居家风险投影
param(
    [string]$Scene = "home",
    [string]$PersonProfile = "",
    [string]$HomeSnapshot = "",
    [string]$Output = ""
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$semanticDir = "$repoRoot\pipeline\data\$Scene\semantic"

if (-not $PersonProfile) { $PersonProfile = "$repoRoot\pipeline\semantic\person-twin.example.json" }
if (-not $HomeSnapshot) {
    $candidate = "$semanticDir\hometwin-surface-route.json"
    if (Test-Path $candidate) { $HomeSnapshot = $candidate } else { $HomeSnapshot = "$semanticDir\hometwin-semantic.json" }
}
if (-not $Output) { $Output = "$semanticDir\person-home-risk.json" }

if (-not (Test-Path $PersonProfile)) { throw "缺少 Person Twin profile: $PersonProfile" }
if (-not (Test-Path $HomeSnapshot)) { throw "缺少 Home Twin snapshot: $HomeSnapshot" }
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
Write-Host "注意：该模块仅做功能状态与空间证据组合，不进行疾病诊断。" -ForegroundColor Yellow
