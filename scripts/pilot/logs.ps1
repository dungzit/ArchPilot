<#
.SYNOPSIS
  Show the pilot container log (JSON lines, one per request/event).

.PARAMETER Tail
  Number of last lines to show. Default 100.

.PARAMETER Follow
  Keep streaming new lines until Ctrl+C.

.PARAMETER Since
  Only lines newer than this, e.g. 30m, 2h, 2026-10-15T08:00:00.

.PARAMETER Errors
  Show only WARNING/ERROR/CRITICAL lines (not combinable with -Follow).

.EXAMPLE
  .\scripts\pilot\logs.ps1 -Tail 300 -Errors
  .\scripts\pilot\logs.ps1 -Follow
#>
[CmdletBinding()]
param(
    [int]$Tail = 100,
    [switch]$Follow,
    [string]$Since = '',
    [switch]$Errors
)

. "$PSScriptRoot\_common.ps1"

Assert-DockerReady
if ($null -eq (Get-PilotContainerState)) {
    Stop-Pilot ('container ' + $PilotContainer + ' does not exist (never started, or removed by stop.ps1).')
}

$dockerArgs = @('logs', '--tail', [string]$Tail)
if ($Since) { $dockerArgs += @('--since', $Since) }

if ($Errors) {
    $dockerArgs += $PilotContainer
    $r = Get-DockerText -DockerArgs $dockerArgs
    $hits = @($r.Output -split "`r?`n" | Where-Object { $_ -match '"level": "(WARNING|ERROR|CRITICAL)"' })
    if ($hits.Count -eq 0) { Write-Ok 'no WARNING/ERROR lines in the selected range' }
    else { $hits | ForEach-Object { Write-Host $_ } }
    exit 0
}

if ($Follow) { $dockerArgs += '--follow' }
$dockerArgs += $PilotContainer
$code = Invoke-Docker -DockerArgs $dockerArgs
exit $code
