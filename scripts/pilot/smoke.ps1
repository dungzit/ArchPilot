<#
.SYNOPSIS
  End-to-end smoke test of the running pilot: health, SPA, login, authenticated call, CSRF.

.DESCRIPTION
  Checks, in order:
    1. GET /api/health = 200 and status ok
    2. GET /  serves the SPA index (and its JavaScript bundle); a deep link also gets index.html
    3. an unknown /api path is a JSON 404, not HTML
    4. login as the test admin 'pilot-smoke' (created on first run, password stored ONLY in
       pilot-data\secrets\pilot-smoke.secret.csv, never printed)
    5. the session + CSRF cookies are NOT marked Secure (a Secure cookie is dropped by browsers on
       plain http://<lan-ip>, which would make every login silently fail)
    6. GET /api/auth/me and GET /api/designs work with the session (authenticated endpoints)
    7. a CSRF-protected POST: /api/auth/logout WITHOUT the x-csrf-token header is rejected (403),
       WITH the header it succeeds (200), and the session is dead afterwards (401)
  Exit code 0 = all passed, 1 = at least one check failed.

.PARAMETER BaseUrl
  Default http://127.0.0.1:<port from pilot.env>. Use http://<LAN-IP>:8000 to test the LAN path.

.PARAMETER Username
  Smoke test account. Default pilot-smoke (role admin).

.PARAMETER SecretFile
  CSV with columns username,password. Default pilot-data\secrets\pilot-smoke.secret.csv.
  After reset-password.ps1 use pilot-data\secrets\pilot-password-resets.secret.csv.

.PARAMETER WaitSeconds
  How long to wait for /api/health first. Default 60.

.EXAMPLE
  .\scripts\pilot\smoke.ps1
#>
[CmdletBinding()]
param(
    [string]$BaseUrl = '',
    [string]$Username = 'pilot-smoke',
    [string]$SecretFile = '',
    [int]$WaitSeconds = 60
)

. "$PSScriptRoot\_common.ps1"

if (-not $BaseUrl) { $BaseUrl = 'http://127.0.0.1:' + (Get-PilotPort) }
$BaseUrl = $BaseUrl.TrimEnd('/')
if (-not $SecretFile) { $SecretFile = Join-Path $PilotSecrets 'pilot-smoke.secret.csv' }

$script:passed = 0
$script:failed = 0

function Test-Check {
    param([string]$Name, [bool]$Ok, [string]$Detail = '')
    $text = $Name
    if ($Detail) { $text = $Name + '  (' + $Detail + ')' }
    if ($Ok) { $script:passed++; Write-Ok $text }
    else { $script:failed++; Write-Fail $text }
}

function ConvertFrom-JsonSafe {
    param([string]$Text)
    try { return ($Text | ConvertFrom-Json) } catch { return $null }
}

Write-Step ('Smoke test against ' + $BaseUrl)

# ---- 0. wait for the API -------------------------------------------------------------------
$deadline = (Get-Date).AddSeconds($WaitSeconds)
$health = $null
while ($true) {
    $health = Invoke-PilotHttp -Url ($BaseUrl + '/api/health') -TimeoutSec 5
    if ($health.Status -eq 200) { break }
    if ((Get-Date) -ge $deadline) { break }
    Write-Host ('    waiting for /api/health ... (' + $health.Status + ')')
    Start-Sleep -Seconds 2
}

# ---- 1. health ------------------------------------------------------------------------------
$healthJson = ConvertFrom-JsonSafe -Text $health.Content
$healthOk = ($health.Status -eq 200 -and $null -ne $healthJson -and $healthJson.status -eq 'ok')
$healthDetail = 'HTTP ' + $health.Status
if ($null -ne $healthJson -and $healthJson.schemaVersion) { $healthDetail = $healthDetail + ', schema ' + $healthJson.schemaVersion + ', env ' + $healthJson.env }
Test-Check -Name 'GET /api/health is 200 and status ok' -Ok $healthOk -Detail $healthDetail
if (-not $healthOk) {
    Write-Fail 'The API is not healthy; the remaining checks are skipped. Run .\scripts\pilot\status.ps1 and .\scripts\pilot\logs.ps1.'
    exit 1
}

# ---- 2. SPA ---------------------------------------------------------------------------------
$index = Invoke-PilotHttp -Url ($BaseUrl + '/') -Accept 'text/html'
Test-Check -Name 'GET / serves the SPA index.html' -Ok ($index.Status -eq 200 -and $index.Content -match '<div id="root"') -Detail ('HTTP ' + $index.Status)

$bundle = $null
if ($index.Content -match 'src="(/assets/[^"]+\.js)"') {
    $bundle = Invoke-PilotHttp -Url ($BaseUrl + $Matches[1])
}
if ($null -ne $bundle) {
    Test-Check -Name 'the JavaScript bundle named in index.html is served' -Ok ($bundle.Status -eq 200 -and $bundle.Content.Length -gt 1000) -Detail ('HTTP ' + $bundle.Status + ', ' + $bundle.Content.Length + ' chars')
}
else {
    Test-Check -Name 'the JavaScript bundle named in index.html is served' -Ok $false -Detail 'no /assets/*.js reference found in index.html'
}

$deep = Invoke-PilotHttp -Url ($BaseUrl + '/designs') -Accept 'text/html'
Test-Check -Name 'a deep link (/designs) falls back to index.html' -Ok ($deep.Status -eq 200 -and $deep.Content -match '<div id="root"') -Detail ('HTTP ' + $deep.Status)

# ---- 3. API 404 stays JSON --------------------------------------------------------------------
$nf = Invoke-PilotHttp -Url ($BaseUrl + '/api/this-does-not-exist') -Accept 'text/html'
Test-Check -Name 'unknown /api path is a JSON 404 (not the SPA)' -Ok ($nf.Status -eq 404 -and $nf.Content -match '"detail"') -Detail ('HTTP ' + $nf.Status)

# ---- 4. credentials -------------------------------------------------------------------------
$password = $null
if (Test-Path -LiteralPath $SecretFile) {
    $row = @(Import-Csv -LiteralPath $SecretFile -Encoding UTF8 | Where-Object { $_.username -eq $Username }) | Select-Object -Last 1
    if ($row) { $password = [string]$row.password }
}
if (-not $password) {
    Write-Step ("Creating the smoke test admin '" + $Username + "' (first run)")
    Assert-DockerReady
    Assert-PilotRunning
    $generated = New-PilotPassword
    $created = New-PilotUser -Username $Username -DisplayName 'Pilot Smoke (test admin)' -Role 'admin' -Password $generated
    if ($created.Result -eq 'created') {
        Add-PilotSecretRow -Path $SecretFile -Username $Username -DisplayName 'Pilot Smoke (test admin)' -Role 'admin' -Password $generated
        $password = $generated
        Write-Ok ('created ' + $Username + '; password stored in ' + $SecretFile)
    }
    elseif ($created.Result -eq 'exists') {
        Write-Fail ("User '" + $Username + "' already exists but no password is stored in " + $SecretFile + '.')
        Write-Host ('  Fix: .\scripts\pilot\reset-password.ps1 -Username ' + $Username + '   then   .\scripts\pilot\smoke.ps1 -SecretFile pilot-data\secrets\pilot-password-resets.secret.csv')
        exit 1
    }
    else {
        Write-Fail ('could not create the smoke test admin: ' + $created.Message)
        exit 1
    }
    $generated = $null
}

# ---- 5. login --------------------------------------------------------------------------------
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$loginBody = (New-Object psobject -Property @{ username = $Username; password = $password }) | ConvertTo-Json -Compress
$login = Invoke-PilotHttp -Url ($BaseUrl + '/api/auth/login') -Method 'POST' -Body $loginBody -Session $session
$password = $null
$loginBody = $null
$loginJson = ConvertFrom-JsonSafe -Text $login.Content
$csrf = ''
if ($null -ne $loginJson -and $loginJson.csrfToken) { $csrf = [string]$loginJson.csrfToken }
Test-Check -Name 'POST /api/auth/login succeeds' -Ok ($login.Status -eq 200 -and $csrf.Length -gt 0) -Detail ('HTTP ' + $login.Status)
if ($login.Status -ne 200) {
    Write-Fail ('login failed: ' + $login.Content)
    Write-Host '  If the user was restored from an older backup, recreate it: .\scripts\pilot\reset-password.ps1 / create-users.ps1'
    exit 1
}

$setCookie = ''
if ($null -ne $login.Headers) {
    try {
        $raw = $login.Headers['Set-Cookie']
        if ($raw) { $setCookie = ($raw -join ' ; ') }
    }
    catch { }
}
# What the client keeps for this http:// URL. A Secure cookie would be missing here, exactly as a
# browser would refuse to store/send it on plain HTTP.
$cookieNames = @()
try {
    foreach ($c in $session.Cookies.GetCookies([Uri]$BaseUrl)) { $cookieNames += [string]$c.Name }
}
catch { }
Test-Check -Name 'session + CSRF cookies are accepted by an http:// client' -Ok (($cookieNames -contains 'archpilot_session') -and ($cookieNames -contains 'archpilot_csrf')) -Detail ('cookies kept: ' + ($cookieNames -join ', '))
Test-Check -Name 'Set-Cookie headers do NOT carry the Secure flag (required for plain HTTP on the LAN)' -Ok ($setCookie -notmatch '(?i);\s*secure\b') -Detail 'if this fails: set ARCHPILOT_COOKIE_SECURE=false in pilot.env and restart'

# ---- 6. authenticated GETs -----------------------------------------------------------------------
$me = Invoke-PilotHttp -Url ($BaseUrl + '/api/auth/me') -Session $session
$meJson = ConvertFrom-JsonSafe -Text $me.Content
$meOk = ($me.Status -eq 200 -and $null -ne $meJson -and ([string]$meJson.username).ToLower() -eq $Username.ToLower())
$meDetail = 'HTTP ' + $me.Status
if ($null -ne $meJson -and $meJson.role) { $meDetail = $meDetail + ', role ' + $meJson.role }
Test-Check -Name 'GET /api/auth/me returns the logged-in user' -Ok $meOk -Detail $meDetail

$designs = Invoke-PilotHttp -Url ($BaseUrl + '/api/designs') -Session $session
Test-Check -Name 'GET /api/designs (authenticated list) works' -Ok ($designs.Status -eq 200) -Detail ('HTTP ' + $designs.Status)

$anon = Invoke-PilotHttp -Url ($BaseUrl + '/api/designs')
Test-Check -Name 'the same call without a session is rejected (401)' -Ok ($anon.Status -eq 401) -Detail ('HTTP ' + $anon.Status)

# ---- 7. CSRF-protected POST ------------------------------------------------------------------------
$noToken = Invoke-PilotHttp -Url ($BaseUrl + '/api/auth/logout') -Method 'POST' -Session $session
Test-Check -Name 'POST /api/auth/logout WITHOUT x-csrf-token is rejected (403)' -Ok ($noToken.Status -eq 403 -and $noToken.Content -match 'csrf') -Detail ('HTTP ' + $noToken.Status)

$withToken = Invoke-PilotHttp -Url ($BaseUrl + '/api/auth/logout') -Method 'POST' -Session $session -Headers @{ 'x-csrf-token' = $csrf }
Test-Check -Name 'POST /api/auth/logout WITH x-csrf-token succeeds (200)' -Ok ($withToken.Status -eq 200) -Detail ('HTTP ' + $withToken.Status)

$after = Invoke-PilotHttp -Url ($BaseUrl + '/api/auth/me') -Session $session
Test-Check -Name 'the session is revoked after logout (401)' -Ok ($after.Status -eq 401) -Detail ('HTTP ' + $after.Status)

# ---- summary ---------------------------------------------------------------------------------------
Write-Host ''
if ($script:failed -eq 0) {
    Write-Host ('SMOKE PASSED: ' + $script:passed + ' checks') -ForegroundColor Green
    exit 0
}
Write-Host ('SMOKE FAILED: ' + $script:failed + ' failed, ' + $script:passed + ' passed') -ForegroundColor Red
exit 1
