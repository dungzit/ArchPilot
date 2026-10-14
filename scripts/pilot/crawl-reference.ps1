<#
.SYNOPSIS
  Crawl SysDesAi into the reference snapshot, load it, and restart the app so it is served.

.DESCRIPTION
  The crawl runs INSIDE the container, detached (a full crawl takes about 45 minutes), through
  scripts\pilot\crawl_runner.py, which wraps the backend CLI:
      python -m app.reference crawl --out <snapshot> [--limit N]
      python -m app.reference load  --snapshot <snapshot>
  The crawler enforces its own polite rate limit. The app stays up and usable during the crawl.
  Output goes to pilot-data\reference\crawl.log; this script shows it live. Closing this window or
  pressing Ctrl+C does NOT stop the crawl - re-attach with -Follow, cancel with -Stop.

  The snapshot is written under a temporary name and moved into place only when the crawl
  succeeded; the previous snapshot is kept as sysdesai-snapshot.prev.jsonl.gz.
  Afterwards the snapshot is loaded and the container is restarted (about 15 s; skip with
  -NoRestart) so the backend picks it up exactly the way it does at every start.
  Do not run stop.ps1 / start.ps1 while a crawl is running: that kills it.
  Keep the PC awake (no sleep) for the whole crawl.

.PARAMETER Limit
  Test crawl: stop after N designs (for example 20). 0 = full crawl. NOTE: the result replaces the
  current snapshot (the old one is kept as .prev), so run a full crawl afterwards.

.PARAMETER NoRestart
  Do not restart the container after a successful load.

.PARAMETER Follow
  Only attach to a crawl that is already running and show its log.

.PARAMETER Status
  Show whether a crawl is running and the last log lines.

.PARAMETER Stop
  Cancel the running crawl (the existing snapshot is untouched).

.EXAMPLE
  .\scripts\pilot\crawl-reference.ps1 -Limit 20     # smoke test of the crawler, ~1-2 minutes
  .\scripts\pilot\crawl-reference.ps1               # full crawl, ~45 minutes
#>
[CmdletBinding()]
param(
    [int]$Limit = 0,
    [switch]$NoRestart,
    [switch]$Follow,
    [switch]$Status,
    [switch]$Stop,
    [int]$PollSeconds = 5
)

. "$PSScriptRoot\_common.ps1"

if ($Limit -lt 0) { Stop-Pilot 'Limit must be 0 (full crawl) or a positive number.' 2 }
Assert-DockerReady
Assert-PilotRunning

$logFile = Join-Path $PilotRefDir 'crawl.log'
$pidFile = Join-Path $PilotRefDir 'crawl.pid'
$runner = '/pilot/crawl_runner.py'

if ($Status) {
    $r = Get-DockerText -DockerArgs @('exec', $PilotContainer, 'python', $runner, 'status')
    Write-Host $r.Output
    exit $r.ExitCode
}
if ($Stop) {
    $r = Get-DockerText -DockerArgs @('exec', $PilotContainer, 'python', $runner, 'stop')
    Write-Host $r.Output
    exit $r.ExitCode
}

function Show-CrawlLog {
    # Print new log lines until the runner writes __DONE__ (or dies). Returns the full log lines.
    $printed = 0
    $started = Get-Date
    $lastBeat = Get-Date
    $sawPid = $false
    while ($true) {
        $lines = @()
        if (Test-Path -LiteralPath $logFile) {
            $lines = @(Get-Content -LiteralPath $logFile -Encoding UTF8 -ErrorAction SilentlyContinue)
        }
        for ($i = $printed; $i -lt $lines.Count; $i++) { Write-Host $lines[$i] }
        $printed = $lines.Count

        if (@($lines | Where-Object { $_ -match '__DONE__\s*$' }).Count -gt 0) { return $lines }

        if (Test-Path -LiteralPath $pidFile) { $sawPid = $true }
        elseif ($sawPid) {
            Write-Warn2 'the crawl process ended without a completion marker (stopped or crashed); see the log above'
            return $lines
        }
        elseif (((Get-Date) - $started).TotalSeconds -gt 90) {
            Write-Warn2 'the crawl did not start within 90 s'
            return $lines
        }

        if (((Get-Date) - $lastBeat).TotalSeconds -ge 60) {
            $mins = [math]::Round(((Get-Date) - $started).TotalMinutes, 1)
            Write-Host ('    ... crawl running, ' + $mins + ' min elapsed, ' + $lines.Count + ' log lines (Ctrl+C detaches; the crawl keeps running)') -ForegroundColor DarkGray
            $lastBeat = Get-Date
        }
        Start-Sleep -Seconds $PollSeconds
    }
}

if (-not $Follow) {
    Write-Step 'Pre-flight: is the crawler module (app.reference) in this image?'
    $chk = Get-DockerText -DockerArgs @('exec', $PilotContainer, 'python', $runner, 'check')
    if ($chk.ExitCode -ne 0) {
        Stop-Pilot ("The running image has no usable crawler (module app.reference). That work package (WP-B) is not built into this image yet.`n" +
            "  Merge/checkout the branch that contains backend\app\reference, then run  .\scripts\pilot\start.ps1 -Rebuild  and retry.`n" +
            '  Detail: ' + $chk.Output) 3
    }
    Write-Ok $chk.Output

    $running = Get-DockerText -DockerArgs @('exec', $PilotContainer, 'python', $runner, 'status')
    if ($running.Output -match '^running') {
        Stop-Pilot 'A crawl is already running. Attach with -Follow, or cancel with -Stop.' 4
    }

    if (Test-Path -LiteralPath $logFile) { Remove-Item -LiteralPath $logFile -Force }
    if ($Limit -gt 0) {
        Write-Step ('Starting a TEST crawl (limit ' + $Limit + ' designs)')
        $runArgs = @('exec', '-d', $PilotContainer, 'python', $runner, 'run', '--limit', [string]$Limit)
    }
    else {
        Write-Step 'Starting the FULL crawl (about 45 minutes, polite rate limit enforced by the crawler)'
        $runArgs = @('exec', '-d', $PilotContainer, 'python', $runner, 'run')
    }
    $code = Invoke-Docker -DockerArgs $runArgs
    if ($code -ne 0) { Stop-Pilot "Could not start the crawl (exit $code)." }
}

if ($Follow -and -not (Test-Path -LiteralPath $pidFile)) {
    Write-Warn2 'no crawl is running. Last log (if any):'
    if (Test-Path -LiteralPath $logFile) { Get-Content -LiteralPath $logFile -Encoding UTF8 -Tail 20 | ForEach-Object { Write-Host ('  ' + $_) } }
    exit 0
}

Write-Step ('Following ' + $logFile)
$lines = @(Show-CrawlLog)

$crawlExit = $null
$loadExit = $null
foreach ($l in $lines) {
    if ($l -match '__CRAWL_EXIT=(-?\d+)') { $crawlExit = $Matches[1] }
    if ($l -match '__LOAD_EXIT=(\S+)') { $loadExit = $Matches[1] }
}

if ($null -eq $crawlExit) {
    Stop-Pilot 'The crawl did not finish (no exit marker). Check the log, then retry or use -Stop.' 1
}
if ($crawlExit -ne '0') {
    Write-Fail ('The crawl failed (exit ' + $crawlExit + '). The existing snapshot is untouched. Last log lines:')
    @($lines | Select-Object -Last 15) | ForEach-Object { Write-Host ('  ' + $_) }
    exit 1
}
Write-Ok 'crawl finished; snapshot in place'

if ($loadExit -ne '0') {
    Write-Warn2 ('loading the snapshot reported "' + $loadExit + '". The snapshot file is saved; the backend also tries to load it at every start. See the log above.')
}
else {
    Write-Ok 'snapshot loaded into the database'
}

if ($NoRestart) {
    Write-Host 'Skipped the restart (-NoRestart). Restart later with:  docker compose -f docker-compose.pilot.yml --env-file pilot.env restart'
    exit 0
}
Write-Step 'Restarting the app so it serves the new snapshot'
$code = Invoke-Compose -ComposeArgs @('restart', '--timeout', '30')
if ($code -ne 0) { Stop-Pilot "docker compose restart failed (exit $code)." }
if (-not (Wait-PilotReady -TimeoutSeconds 120)) { Stop-Pilot 'The app did not come back after the restart; see .\scripts\pilot\logs.ps1' }
$health = Invoke-PilotHttp -Url ('http://127.0.0.1:' + (Get-PilotPort) + '/api/health')
Write-Ok ('health: ' + $health.Content)
exit 0
