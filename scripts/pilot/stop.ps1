<#
.SYNOPSIS
  Stop the ArchPilot pilot (graceful). Data in pilot-data\ and the image are kept.

.DESCRIPTION
  Runs docker compose down: sends SIGTERM (uvicorn finishes in-flight requests,
  SQLite checkpoints its WAL), then removes the container and the compose network.
  Nothing under pilot-data\ is touched; the image archpilot-pilot:local is kept.
  Start again with start.ps1.

.PARAMETER Backup
  Take a backup (backup.ps1) before stopping.

.EXAMPLE
  .\scripts\pilot\stop.ps1 -Backup
#>
[CmdletBinding()]
param(
    [switch]$Backup
)

. "$PSScriptRoot\_common.ps1"

Assert-DockerReady

if ($Backup) {
    $state = Get-PilotContainerState
    if ($null -ne $state -and $state.Status -eq 'running') {
        Write-Step 'Backup before stopping'
        & "$PSScriptRoot\backup.ps1"
        if ($LASTEXITCODE -ne 0) {
            Stop-Pilot 'Backup failed; the pilot was NOT stopped. Fix the backup problem or stop without -Backup.'
        }
    }
    else {
        Write-Warn2 'container is not running; skipping the backup'
    }
}

Write-Step 'Stopping the pilot (docker compose down)'
$code = Invoke-Compose -ComposeArgs @('down', '--timeout', '30')
if ($code -ne 0) { Stop-Pilot ("docker compose down failed (exit $code).") }
Write-Ok 'stopped. Data is in pilot-data\ (kept). Start again with .\scripts\pilot\start.ps1'
exit 0
