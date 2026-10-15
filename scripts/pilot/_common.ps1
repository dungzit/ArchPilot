# Shared helpers for scripts/pilot/*.ps1.  Dot-source it:  . "$PSScriptRoot\_common.ps1"
#
# Windows PowerShell 5.1 compatible (no &&, no ternary, no ??, no $PSStyle).
# ASCII only on purpose: PowerShell 5.1 reads a BOM-less .ps1 as ANSI, so any
# accented character in a string would be corrupted.
#
# Native-command rule used everywhere below: never combine
# $ErrorActionPreference='Stop' with 2>&1 on docker.exe. Windows PowerShell 5.1
# turns every stderr line into a terminating error, and docker writes progress
# to stderr. Invoke-Docker / Get-DockerText switch to 'Continue' and the callers
# test $LASTEXITCODE / .ExitCode instead.

$ErrorActionPreference = 'Stop'

$PilotRoot      = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$PilotCompose   = Join-Path $PilotRoot 'docker-compose.pilot.yml'
$PilotEnvFile   = Join-Path $PilotRoot 'pilot.env'
$PilotEnvSample = Join-Path $PilotRoot 'pilot.env.example'
$PilotData      = Join-Path $PilotRoot 'pilot-data'
$PilotBackups   = Join-Path $PilotData 'backups'
$PilotRefDir    = Join-Path $PilotData 'reference'
$PilotSecrets   = Join-Path $PilotData 'secrets'
$PilotService   = 'archpilot'
$PilotContainer = 'archpilot-pilot'
$PilotImage     = 'archpilot-pilot:local'

# --------------------------------------------------------------------------
# Console output
# --------------------------------------------------------------------------
function Write-Step { param([string]$Message) Write-Host ('==> ' + $Message) -ForegroundColor Cyan }
function Write-Ok   { param([string]$Message) Write-Host ('[ OK ] ' + $Message) -ForegroundColor Green }
function Write-Warn2 { param([string]$Message) Write-Host ('[WARN] ' + $Message) -ForegroundColor Yellow }
function Write-Fail { param([string]$Message) Write-Host ('[FAIL] ' + $Message) -ForegroundColor Red }

function Stop-Pilot {
    # Print a failure and end the calling script with a non-zero exit code.
    param([string]$Message, [int]$Code = 1)
    Write-Fail $Message
    exit $Code
}

# --------------------------------------------------------------------------
# docker.exe wrappers
# --------------------------------------------------------------------------
function Invoke-Docker {
    # Run docker, stream its output to the console, return the exit code.
    param([string[]]$DockerArgs)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & docker @DockerArgs | Out-Host
        return [int]$LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Get-DockerText {
    # Run docker, capture stdout+stderr as text. Returns @{ ExitCode; Output }.
    param([string[]]$DockerArgs)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $lines = & docker @DockerArgs 2>&1 | ForEach-Object { [string]$_ }
        $code = [int]$LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }
    $text = ''
    if ($lines) { $text = (($lines | Out-String).TrimEnd()) }
    return New-Object psobject -Property @{ ExitCode = $code; Output = $text }
}

function Get-ComposeBase {
    $base = @('compose', '-f', $PilotCompose)
    if (Test-Path -LiteralPath $PilotEnvFile) { $base += @('--env-file', $PilotEnvFile) }
    return $base
}

function Invoke-Compose {
    # docker compose -f <pilot file> --env-file pilot.env <args>; returns exit code.
    param([string[]]$ComposeArgs)
    $all = @(Get-ComposeBase) + $ComposeArgs
    return (Invoke-Docker -DockerArgs $all)
}

function Assert-DockerReady {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Stop-Pilot 'docker.exe was not found in PATH. Install Docker Desktop and reopen PowerShell.'
    }
    $r = Get-DockerText -DockerArgs @('info', '--format', '{{.ServerVersion}}')
    if ($r.ExitCode -ne 0) {
        Stop-Pilot ("Docker engine is not running. Start Docker Desktop, wait until it says 'Engine running', then retry.`n" + $r.Output)
    }
}

function Initialize-PilotFiles {
    # Create the data folders and pilot.env (from pilot.env.example) if missing.
    foreach ($dir in @($PilotData, $PilotBackups, $PilotRefDir, $PilotSecrets)) {
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    }
    if (-not (Test-Path -LiteralPath $PilotEnvFile)) {
        if (-not (Test-Path -LiteralPath $PilotEnvSample)) {
            Stop-Pilot ('pilot.env.example is missing: ' + $PilotEnvSample)
        }
        Copy-Item -LiteralPath $PilotEnvSample -Destination $PilotEnvFile
        Write-Ok 'created pilot.env from pilot.env.example (edit it to change port or session lifetime)'
    }
}

function Get-PilotSetting {
    # Read NAME=value from pilot.env (no quotes handling needed; see the example file).
    param([string]$Name, [string]$Default = '')
    if (Test-Path -LiteralPath $PilotEnvFile) {
        $pattern = '^\s*' + [regex]::Escape($Name) + '\s*=\s*(.*?)\s*$'
        foreach ($line in (Get-Content -LiteralPath $PilotEnvFile)) {
            if ($line -match $pattern) { return $Matches[1] }
        }
    }
    return $Default
}

function Get-PilotPort {
    $p = Get-PilotSetting -Name 'ARCHPILOT_PILOT_PORT' -Default '8000'
    $n = 0
    if ([int]::TryParse($p, [ref]$n) -and $n -gt 0 -and $n -lt 65536) { return $n }
    return 8000
}

function Get-PilotContainerState {
    # $null when the container does not exist, else @{ Status; Health }.
    $format = '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}'
    $r = Get-DockerText -DockerArgs @('inspect', '-f', $format, $PilotContainer)
    if ($r.ExitCode -ne 0) { return $null }
    $parts = $r.Output.Trim().Split('|')
    if ($parts.Count -lt 2) { return $null }
    return New-Object psobject -Property @{ Status = $parts[0]; Health = $parts[1] }
}

function Assert-PilotRunning {
    $state = Get-PilotContainerState
    if ($null -eq $state -or $state.Status -ne 'running') {
        Stop-Pilot 'The pilot container is not running. Start it first:  .\scripts\pilot\start.ps1'
    }
}

# --------------------------------------------------------------------------
# Network helpers
# --------------------------------------------------------------------------
function Test-PortInUse {
    param([int]$Port)
    try {
        $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
        foreach ($endpoint in $listeners) {
            if ($endpoint.Port -eq $Port) { return $true }
        }
    }
    catch { }
    return $false
}

function Get-LanIPv4 {
    # The office-LAN address(es) of this PC: adapters with an IPv4 default gateway
    # first (skips the many vEthernet/WSL/Hyper-V adapters), then a filtered list.
    $found = @()
    try {
        $configs = Get-NetIPConfiguration -ErrorAction Stop |
            Where-Object { $null -ne $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' }
        foreach ($c in @($configs)) {
            foreach ($a in @($c.IPv4Address)) {
                if ($a -and $a.IPAddress) { $found += [string]$a.IPAddress }
            }
        }
    }
    catch { }
    if ($found.Count -eq 0) {
        try {
            $all = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
                Where-Object {
                    $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and
                    $_.InterfaceAlias -notmatch 'vEthernet|WSL|Docker|VMware|VirtualBox|Loopback|Bluetooth|Hyper-V'
                }
            foreach ($a in @($all)) { $found += [string]$a.IPAddress }
        }
        catch { }
    }
    if ($found.Count -eq 0) {
        try {
            foreach ($a in [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName())) {
                if ($a.AddressFamily -eq 'InterNetwork' -and $a.ToString() -notmatch '^(127\.|169\.254\.)') {
                    $found += $a.ToString()
                }
            }
        }
        catch { }
    }
    return @($found | Select-Object -Unique)
}

function Show-PilotUrls {
    $port = Get-PilotPort
    Write-Host ''
    Write-Host 'ArchPilot pilot is reachable at:' -ForegroundColor Green
    Write-Host ('  This PC     : http://localhost:' + $port + '/')
    $ips = @(Get-LanIPv4)
    if ($ips.Count -eq 0) {
        Write-Warn2 'no LAN IPv4 address found; run ipconfig and use that address'
    }
    foreach ($ip in $ips) {
        Write-Host ('  Other PCs   : http://' + $ip + ':' + $port + '/') -ForegroundColor Green
    }
    Write-Host ('  If other PCs cannot connect, the Windows firewall rule for TCP ' + $port + ' is missing; see docs/v3/pilot/RUNBOOK.md section 3.')
    Write-Host ''
}

function Invoke-PilotHttp {
    # Small HTTP client that behaves the same on Windows PowerShell 5.1 and 7:
    # never throws on 4xx/5xx; returns @{ Status; Content; Headers; Error }.
    param(
        [string]$Url,
        [string]$Method = 'GET',
        [string]$Body = $null,
        $Session = $null,
        [hashtable]$Headers = @{},
        [string]$Accept = $null,
        [int]$TimeoutSec = 15
    )
    $params = @{ Uri = $Url; Method = $Method; UseBasicParsing = $true; TimeoutSec = $TimeoutSec }
    $hdr = @{}
    foreach ($k in $Headers.Keys) { $hdr[$k] = $Headers[$k] }
    if ($Accept) { $hdr['Accept'] = $Accept }
    if ($hdr.Count -gt 0) { $params['Headers'] = $hdr }
    # A [string] parameter defaulting to $null becomes '' in PowerShell, so test for empty, not for $null
    # (a GET with an empty body would otherwise throw in Windows PowerShell 5.1).
    if (-not [string]::IsNullOrEmpty($Body)) { $params['Body'] = $Body; $params['ContentType'] = 'application/json' }
    if ($null -ne $Session) { $params['WebSession'] = $Session }
    try {
        $r = Invoke-WebRequest @params
        return New-Object psobject -Property @{ Status = [int]$r.StatusCode; Content = [string]$r.Content; Headers = $r.Headers; Error = $null }
    }
    catch {
        $err = $_
        $resp = $err.Exception.Response
        if ($null -ne $resp) {
            $text = ''
            try {
                $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
                $text = $reader.ReadToEnd()
                $reader.Close()
            }
            catch { }
            # Windows PowerShell 5.1 has already consumed the error body by the time we get here;
            # it is exposed as ErrorDetails.Message instead of the response stream.
            if ([string]::IsNullOrEmpty($text) -and $null -ne $err.ErrorDetails) { $text = [string]$err.ErrorDetails.Message }
            return New-Object psobject -Property @{ Status = [int]$resp.StatusCode; Content = $text; Headers = $resp.Headers; Error = $err.Exception.Message }
        }
        return New-Object psobject -Property @{ Status = 0; Content = ''; Headers = $null; Error = $_.Exception.Message }
    }
}

function Wait-PilotReady {
    # Wait until the container is running AND /api/health answers 200 on the host port.
    # Returns $true/$false. Docker's own health flag is reported by the caller.
    param([int]$TimeoutSeconds = 120)
    $url = 'http://127.0.0.1:' + (Get-PilotPort) + '/api/health'
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastStatus = ''
    while ((Get-Date) -lt $deadline) {
        $state = Get-PilotContainerState
        if ($null -ne $state) {
            if ($state.Status -eq 'exited' -or $state.Status -eq 'dead') { return $false }
            if ($state.Status -eq 'running') {
                $resp = Invoke-PilotHttp -Url $url -TimeoutSec 5
                if ($resp.Status -eq 200) { return $true }
                $lastStatus = 'http ' + $resp.Status
            }
        }
        Write-Host ('    waiting for the app ... ' + $lastStatus)
        Start-Sleep -Seconds 3
    }
    return $false
}

# --------------------------------------------------------------------------
# Users and passwords
# --------------------------------------------------------------------------
function New-PilotPassword {
    # 16 random characters (about 93 bits) from an alphabet without look-alike
    # characters (no 0 O o 1 l I). Cryptographic RNG, rejection sampling (no bias).
    param([int]$Length = 16)
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
    $limit = 256 - (256 % $alphabet.Length)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $sb = New-Object System.Text.StringBuilder
    $buffer = New-Object byte[] 64
    try {
        while ($sb.Length -lt $Length) {
            $rng.GetBytes($buffer)
            foreach ($b in $buffer) {
                if ($b -lt $limit -and $sb.Length -lt $Length) {
                    [void]$sb.Append($alphabet[[int]($b % $alphabet.Length)])
                }
            }
        }
    }
    finally {
        $rng.Dispose()
    }
    return $sb.ToString()
}

function Test-PilotUsername {
    param([string]$Username)
    return ($Username -match '^[A-Za-z0-9][A-Za-z0-9._@-]{1,62}$')
}

function Add-PilotSecretRow {
    # Append one row to a gitignored secrets CSV (UTF-8 with BOM so Excel shows
    # Vietnamese names correctly). The header is written when the file is new.
    param([string]$Path, [string]$Username, [string]$DisplayName, [string]$Role, [string]$Password)
    $row = New-Object psobject -Property ([ordered]@{
            username    = $Username
            display_name = $DisplayName
            role        = $Role
            password    = $Password
            created_utc = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        })
    $csv = @($row | ConvertTo-Csv -NoTypeInformation)
    if (Test-Path -LiteralPath $Path) { $csv = @($csv[1]) }
    $text = (($csv -join "`r`n") + "`r`n")
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    [System.IO.File]::AppendAllText($Path, $text, (New-Object System.Text.UTF8Encoding($true)))
}

function New-PilotUser {
    # Create one user inside the running container through backend/scripts/create_user.py.
    # The password travels on stdin only (never argv, never echoed, never logged).
    # Returns @{ Result = 'created' | 'exists' | 'error'; Message }.
    param([string]$Username, [string]$DisplayName, [string]$Role, [string]$Password)
    $dockerArgs = @('exec', '-i', $PilotContainer, 'python', '-m', 'scripts.create_user', $Username, '--role', $Role, '--password-stdin')
    if ($DisplayName) { $dockerArgs += @('--display-name', $DisplayName) }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $lines = $Password | & docker @dockerArgs 2>&1 | ForEach-Object { [string]$_ }
        $code = [int]$LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }
    $message = ''
    if ($lines) { $message = (($lines | Out-String).Trim()) }
    if ($code -eq 0) { return New-Object psobject -Property @{ Result = 'created'; Message = $message } }
    if ($code -eq 3) { return New-Object psobject -Property @{ Result = 'exists'; Message = $message } }
    return New-Object psobject -Property @{ Result = 'error'; Message = ('exit ' + $code + ': ' + $message) }
}
