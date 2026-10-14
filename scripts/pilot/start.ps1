<#
.SYNOPSIS
  Build (if needed) and start the ArchPilot pilot, wait until it answers, print the LAN URL(s).

.DESCRIPTION
  1. checks that the Docker engine is running;
  2. creates pilot-data\ and pilot.env (from pilot.env.example) when missing;
  3. builds the single SPA+API image (layer cache makes a no-change build take seconds);
  4. docker compose up -d;
  5. waits for GET /api/health = 200 and prints http://<LAN-IP>:<port>/ .

.PARAMETER Rebuild
  Build without the layer cache (after a base-image update or a strange build state).

.PARAMETER SkipBuild
  Do not run an explicit build step (compose still builds when the image is missing).

.PARAMETER TimeoutSeconds
  How long to wait for the app to answer. Default 150.

.EXAMPLE
  .\scripts\pilot\start.ps1
#>
[CmdletBinding()]
param(
    [switch]$Rebuild,
    [switch]$SkipBuild,
    [int]$TimeoutSeconds = 150
)

. "$PSScriptRoot\_common.ps1"

Write-Step 'Checking the Docker engine'
Assert-DockerReady
Initialize-PilotFiles

$port = Get-PilotPort
$state = Get-PilotContainerState
$running = ($null -ne $state -and $state.Status -eq 'running')
if (-not $running -and (Test-PortInUse -Port $port)) {
    Stop-Pilot ("Port $port is already in use by another program. Find it:  netstat -ano | findstr :$port   " +
        "Either stop that program or set ARCHPILOT_PILOT_PORT in pilot.env to a free port, then run start.ps1 again.")
}

if (-not $SkipBuild) {
    Write-Step 'Building the image (cached layers make this fast when nothing changed)'
    $buildArgs = @('build')
    if ($Rebuild) { $buildArgs += '--no-cache' }
    $code = Invoke-Compose -ComposeArgs $buildArgs
    if ($code -ne 0) {
        Stop-Pilot ("Image build failed (exit $code). Read the first error above. Usual causes: no internet access " +
            'for npm/pip, a full disk, or Docker Desktop low on memory.')
    }
}

Write-Step 'Starting the container'
$code = Invoke-Compose -ComposeArgs @('up', '-d')
if ($code -ne 0) {
    Stop-Pilot ("docker compose up failed (exit $code). If the message mentions a port, see the port-in-use hint above.")
}

Write-Step 'Waiting for the app to answer /api/health'
if (-not (Wait-PilotReady -TimeoutSeconds $TimeoutSeconds)) {
    Write-Fail 'The app did not become ready in time. Last 40 log lines:'
    [void](Invoke-Docker -DockerArgs @('logs', '--tail', '40', $PilotContainer))
    Stop-Pilot 'Startup failed. See docs/v3/pilot/RUNBOOK.md, section on troubleshooting (container unhealthy).'
}

$health = Invoke-PilotHttp -Url ('http://127.0.0.1:' + $port + '/api/health') -TimeoutSec 10
Write-Ok ('health: ' + $health.Content)
$state = Get-PilotContainerState
if ($null -ne $state) {
    Write-Ok ('container: ' + $state.Status + ', docker health flag: ' + $state.Health + " (turns 'healthy' within about 20 s)")
}
Show-PilotUrls
Write-Host 'Next: create users   .\scripts\pilot\create-users.ps1     |  verify   .\scripts\pilot\smoke.ps1'
exit 0
