<#
.SYNOPSIS
  Consistent SQLite backup into pilot-data\backups\archpilot-<UTC timestamp>.db, keeping the last 14.

.DESCRIPTION
  Uses the application's own backup script (backend\scripts\backup.py: VACUUM INTO, safe while the
  app is running; NEVER copy a live WAL-mode database file by hand). Runs the integrity check on the
  new file. Works with the container running (docker exec) or stopped (one-off container).
  Snapshots named *-premigrate.db (taken automatically before a schema migration) are never pruned.

.PARAMETER Keep
  Scheduled snapshots to retain. Default 14.

.PARAMETER CopyTo
  Also copy the new backup to this folder (another disk, USB drive, network share).

.PARAMETER NoVerify
  Skip PRAGMA integrity_check on the new file.

.EXAMPLE
  .\scripts\pilot\backup.ps1
  .\scripts\pilot\backup.ps1 -CopyTo E:\archpilot-backups
#>
[CmdletBinding()]
param(
    [int]$Keep = 14,
    [string]$CopyTo = '',
    [switch]$NoVerify
)

. "$PSScriptRoot\_common.ps1"

if ($Keep -lt 1) { Stop-Pilot 'Keep must be 1 or more.' 2 }
Assert-DockerReady
Initialize-PilotFiles

$dbName = Split-Path -Leaf (Get-PilotSetting -Name 'ARCHPILOT_DB_PATH' -Default '/data/archpilot.db')
if (-not (Test-Path -LiteralPath (Join-Path $PilotData $dbName))) {
    Stop-Pilot ('Database not found: ' + (Join-Path $PilotData $dbName) + '. Nothing to back up yet (start the pilot once first).')
}

$backupCmd = @('python', '-m', 'scripts.backup', '--keep', [string]$Keep)
if (-not $NoVerify) { $backupCmd += '--verify' }

$state = Get-PilotContainerState
Write-Step 'Backing up the database'
if ($null -ne $state -and $state.Status -eq 'running') {
    $code = Invoke-Docker -DockerArgs (@('exec', $PilotContainer) + $backupCmd)
}
else {
    Write-Warn2 'container is not running; using a one-off container (same image, same data folder)'
    $code = Invoke-Compose -ComposeArgs (@('run', '--rm', '--no-deps', '-T', $PilotService) + $backupCmd)
}
if ($code -ne 0) {
    Stop-Pilot ("Backup failed (exit $code). If the message says 'database is locked', wait a minute and retry; if the image is missing run start.ps1 first.")
}

$all = @(Get-ChildItem -LiteralPath $PilotBackups -Filter 'archpilot-*.db' | Sort-Object LastWriteTime -Descending)
if ($all.Count -eq 0) { Stop-Pilot 'The backup command reported success but no file is in pilot-data\backups.' }
$newest = $all[0]
Write-Ok ('backup: ' + $newest.FullName + '  (' + [math]::Round($newest.Length / 1KB, 0) + ' KB)')
Write-Host ('  backups on disk: ' + $all.Count + ' (retention: ' + $Keep + ' scheduled + all *-premigrate)')

if ($CopyTo) {
    try {
        if (-not (Test-Path -LiteralPath $CopyTo)) { New-Item -ItemType Directory -Path $CopyTo | Out-Null }
        Copy-Item -LiteralPath $newest.FullName -Destination $CopyTo -Force
        Write-Ok ('copied to ' + $CopyTo)
    }
    catch {
        Stop-Pilot ('Backup is OK but the copy to ' + $CopyTo + ' failed: ' + $_.Exception.Message)
    }
}
exit 0
