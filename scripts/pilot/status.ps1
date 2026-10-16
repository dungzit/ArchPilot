<#
.SYNOPSIS
  One-screen health report of the ArchPilot pilot (container, API, data, backups, reference index).

.DESCRIPTION
  Read-only. Exit code 0 when the container is running and /api/health answers 200,
  otherwise 1 (usable from a scheduled task or a monitoring one-liner).

.EXAMPLE
  .\scripts\pilot\status.ps1
#>
[CmdletBinding()]
param()

. "$PSScriptRoot\_common.ps1"

Write-Step 'Docker engine'
Assert-DockerReady
Write-Ok 'engine is running'

$healthy = $false
$port = Get-PilotPort

Write-Step 'Container'
$state = Get-PilotContainerState
if ($null -eq $state) {
    Write-Warn2 ('container ' + $PilotContainer + ' does not exist. Start it with .\scripts\pilot\start.ps1')
}
else {
    $info = Get-DockerText -DockerArgs @('inspect', '-f', 'started={{.State.StartedAt}} restarts={{.RestartCount}} image={{.Image}}', $PilotContainer)
    Write-Host ('  state : ' + $state.Status + ', docker health flag: ' + $state.Health)
    Write-Host ('  detail: ' + $info.Output)
    $img = Get-DockerText -DockerArgs @('images', $PilotImage, '--format', '{{.Repository}}:{{.Tag}}  {{.Size}}  built {{.CreatedSince}}')
    if ($img.Output) { Write-Host ('  image : ' + $img.Output) }
}

Write-Step ('API (http://127.0.0.1:' + $port + '/api/health)')
$resp = Invoke-PilotHttp -Url ('http://127.0.0.1:' + $port + '/api/health') -TimeoutSec 5
if ($resp.Status -eq 200) {
    Write-Ok $resp.Content
    $healthy = $true
}
else {
    Write-Fail ('HTTP ' + $resp.Status + ' ' + $resp.Error + ' ' + $resp.Content)
}

Write-Step 'Data (pilot-data\)'
$dbName = Split-Path -Leaf (Get-PilotSetting -Name 'ARCHPILOT_DB_PATH' -Default '/data/archpilot.db')
$db = Join-Path $PilotData $dbName
if (Test-Path -LiteralPath $db) {
    $f = Get-Item -LiteralPath $db
    Write-Host ('  database : ' + $f.FullName + '  ' + [math]::Round($f.Length / 1MB, 2) + ' MB  modified ' + $f.LastWriteTime)
}
else {
    Write-Warn2 ('database file not found yet: ' + $db)
}

$backups = @()
if (Test-Path -LiteralPath $PilotBackups) {
    $backups = @(Get-ChildItem -LiteralPath $PilotBackups -Filter 'archpilot-*.db' | Sort-Object LastWriteTime -Descending)
}
if ($backups.Count -gt 0) {
    $latest = $backups[0]
    $ageHours = [math]::Round(((Get-Date) - $latest.LastWriteTime).TotalHours, 1)
    $line = '  backups  : ' + $backups.Count + ' file(s); newest ' + $latest.Name + ' (' + $ageHours + ' h old)'
    if ($ageHours -gt 26) { Write-Warn2 ($line + ' -> older than a day, run backup.ps1') }
    else { Write-Host $line }
}
else {
    Write-Warn2 '  backups  : none yet. Run .\scripts\pilot\backup.ps1'
}

$snapshotName = Split-Path -Leaf (Get-PilotSetting -Name 'ARCHPILOT_REFERENCE_SNAPSHOT' -Default '/data/reference/sysdesai-snapshot.jsonl.gz')
$snapshot = Join-Path $PilotRefDir $snapshotName
if (Test-Path -LiteralPath $snapshot) {
    $s = Get-Item -LiteralPath $snapshot
    Write-Host ('  reference: ' + $s.Name + '  ' + [math]::Round($s.Length / 1MB, 2) + ' MB  from ' + $s.LastWriteTime)
}
else {
    Write-Warn2 '  reference: no SysDesAi snapshot yet (run .\scripts\pilot\crawl-reference.ps1)'
}
if (Test-Path -LiteralPath (Join-Path $PilotRefDir 'crawl.pid')) {
    Write-Warn2 '  a reference crawl is in progress (.\scripts\pilot\crawl-reference.ps1 -Follow)'
}

$drive = Split-Path -Qualifier $PilotRoot
try {
    $disk = Get-PSDrive -Name $drive.TrimEnd(':') -ErrorAction Stop
    Write-Host ('  disk ' + $drive + ' : ' + [math]::Round($disk.Free / 1GB, 1) + ' GB free')
}
catch { }

if ($healthy) { Show-PilotUrls; exit 0 }
exit 1
