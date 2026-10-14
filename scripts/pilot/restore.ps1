<#
.SYNOPSIS
  Restore the database from a backup file (the pilot is stopped for about a minute).

.DESCRIPTION
  1. resolves the backup (name inside pilot-data\backups, a full path, or 'latest');
  2. verifies it (PRAGMA integrity_check) inside a container;
  3. asks you to type RESTORE (skip with -Force);
  4. docker compose down;
  5. MOVES the current database (+ -wal/-shm) to pilot-data\backups\replaced-before-restore-<time>\
     so nothing is lost and the restore itself can be undone;
  6. copies the backup to pilot-data\archpilot.db;
  7. docker compose up -d and waits for /api/health. A backup taken before a schema change is
     migrated forward automatically at startup (the app snapshots first).
  Run without -Backup to list the available backups.

.PARAMETER Backup
  File name in pilot-data\backups, a path to a .db file, or the word latest.

.PARAMETER Force
  Do not ask for the RESTORE confirmation.

.EXAMPLE
  .\scripts\pilot\restore.ps1
  .\scripts\pilot\restore.ps1 -Backup archpilot-20261015T020000Z.db
  .\scripts\pilot\restore.ps1 -Backup latest
#>
[CmdletBinding()]
param(
    [string]$Backup = '',
    [switch]$Force
)

. "$PSScriptRoot\_common.ps1"

Assert-DockerReady
Initialize-PilotFiles

$available = @(Get-ChildItem -LiteralPath $PilotBackups -Filter '*.db' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
if (-not $Backup) {
    Write-Step 'Available backups (newest first)'
    if ($available.Count -eq 0) { Write-Warn2 'none' }
    foreach ($f in $available) {
        Write-Host ('  ' + $f.Name + '   ' + [math]::Round($f.Length / 1KB, 0) + ' KB   ' + $f.LastWriteTime)
    }
    Write-Host ''
    Write-Host 'Restore one with:  .\scripts\pilot\restore.ps1 -Backup <file name>     (or -Backup latest)'
    exit 0
}

# ---- 1. resolve ---------------------------------------------------------------
$source = $null
if ($Backup -eq 'latest') {
    $scheduled = @($available | Where-Object { $_.Name -like 'archpilot-*.db' })
    if ($scheduled.Count -eq 0) { Stop-Pilot 'No archpilot-*.db backup found in pilot-data\backups.' }
    $source = $scheduled[0].FullName
}
elseif (Test-Path -LiteralPath $Backup -PathType Leaf) {
    $source = (Resolve-Path -LiteralPath $Backup).Path
}
elseif (Test-Path -LiteralPath (Join-Path $PilotBackups $Backup) -PathType Leaf) {
    $source = (Join-Path $PilotBackups $Backup)
}
else {
    Stop-Pilot ("Backup not found: $Backup. Run restore.ps1 with no arguments to list the backups.")
}

# A file from outside pilot-data\backups must be copied in so the container can read it.
$backupRoot = (Resolve-Path -LiteralPath $PilotBackups).Path
if (-not $source.StartsWith($backupRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    $importName = 'imported-' + (Get-Date).ToString('yyyyMMdd-HHmmss') + '-' + (Split-Path -Leaf $source)
    Copy-Item -LiteralPath $source -Destination (Join-Path $PilotBackups $importName)
    $source = Join-Path $PilotBackups $importName
    Write-Ok ('copied the file into pilot-data\backups as ' + $importName)
}
$sourceName = Split-Path -Leaf $source

# ---- 2. verify ----------------------------------------------------------------
Write-Step ('Verifying ' + $sourceName)
$verifyCmd = @('python', '/pilot/db_tool.py', 'verify', ('/data/backups/' + $sourceName))
$state = Get-PilotContainerState
if ($null -ne $state -and $state.Status -eq 'running') {
    $v = Get-DockerText -DockerArgs (@('exec', $PilotContainer) + $verifyCmd)
}
else {
    $v = Get-DockerText -DockerArgs (@(Get-ComposeBase) + @('run', '--rm', '--no-deps', '-T', $PilotService) + $verifyCmd)
}
Write-Host $v.Output
if ($v.ExitCode -ne 0) { Stop-Pilot 'The backup file failed verification; nothing was changed.' }

# ---- 3. confirm ---------------------------------------------------------------
if (-not $Force) {
    Write-Warn2 'The pilot will be STOPPED and the current database REPLACED by this backup.'
    Write-Warn2 'Changes made since the backup was taken are not in it (the current database is kept, see below).'
    $answer = Read-Host 'Type RESTORE to continue'
    if ($answer -cne 'RESTORE') {
        Write-Host 'Cancelled; nothing was changed.'
        exit 0
    }
}

# ---- 4. stop ------------------------------------------------------------------
Write-Step 'Stopping the pilot'
$code = Invoke-Compose -ComposeArgs @('down', '--timeout', '30')
if ($code -ne 0) { Stop-Pilot "docker compose down failed (exit $code); nothing was changed." }

# ---- 5. move the current database aside ----------------------------------------
$dbName = Split-Path -Leaf (Get-PilotSetting -Name 'ARCHPILOT_DB_PATH' -Default '/data/archpilot.db')
$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$aside = Join-Path $PilotBackups ('replaced-before-restore-' + $stamp)
New-Item -ItemType Directory -Path $aside | Out-Null
foreach ($suffix in @('', '-wal', '-shm')) {
    $f = Join-Path $PilotData ($dbName + $suffix)
    if (Test-Path -LiteralPath $f) { Move-Item -LiteralPath $f -Destination $aside }
}
Write-Ok ('current database moved to ' + $aside)

# ---- 6. put the backup in place -------------------------------------------------
Copy-Item -LiteralPath $source -Destination (Join-Path $PilotData $dbName)
Write-Ok ('restored ' + $sourceName + ' -> pilot-data\' + $dbName)

# ---- 7. start -------------------------------------------------------------------
Write-Step 'Starting the pilot'
$code = Invoke-Compose -ComposeArgs @('up', '-d')
if ($code -ne 0) { Stop-Pilot "docker compose up failed (exit $code). The restored file is in place; to undo, see below." }
if (-not (Wait-PilotReady -TimeoutSeconds 150)) {
    Write-Fail 'The app did not become ready. Last 40 log lines:'
    [void](Invoke-Docker -DockerArgs @('logs', '--tail', '40', $PilotContainer))
    Stop-Pilot ('Restore finished but the app is not healthy. To undo: stop.ps1, then move the files from ' + $aside + ' back into pilot-data\ and start.ps1.')
}
$health = Invoke-PilotHttp -Url ('http://127.0.0.1:' + (Get-PilotPort) + '/api/health')
Write-Ok ('health: ' + $health.Content)
Write-Host ''
Write-Host ('To UNDO this restore: stop.ps1, delete pilot-data\' + $dbName + ', move the files from') -ForegroundColor Yellow
Write-Host ('  ' + $aside) -ForegroundColor Yellow
Write-Host '  back into pilot-data\, then start.ps1.' -ForegroundColor Yellow
exit 0
