<#
.SYNOPSIS
  Bulk-create pilot users from a CSV (username,display_name,role) with generated passwords.

.DESCRIPTION
  * Input CSV columns: username, display_name, role (member | editor | admin).
    display_name and role may be empty (defaults: username, member).
    Default input file: pilot-data\users.csv (gitignored). Start from scripts\pilot\users.sample.csv.
  * Every row is validated BEFORE anything is created; one bad row stops the whole run.
  * For each user a 16-character random password is generated (cryptographic RNG),
    sent to backend\scripts\create_user.py inside the container on STDIN (never on a command
    line), and written ONLY to pilot-data\secrets\pilot-users.secret.csv (gitignored).
    Passwords are never printed.
  * Re-running is safe: existing usernames are skipped (their password is not changed;
    use reset-password.ps1 for that).
  * The app has no self-service password change yet: hand each user their password
    privately, then delete the secret file (or move it to a password manager).

.PARAMETER CsvPath
  Input CSV. Default pilot-data\users.csv.

.PARAMETER PasswordLength
  Generated password length, 12-64. Default 16.

.PARAMETER DryRun
  Validate the CSV and show what would be created; create nothing, write nothing.

.EXAMPLE
  Copy-Item .\scripts\pilot\users.sample.csv .\pilot-data\users.csv
  notepad .\pilot-data\users.csv
  .\scripts\pilot\create-users.ps1
#>
[CmdletBinding()]
param(
    [string]$CsvPath = '',
    [int]$PasswordLength = 16,
    [switch]$DryRun
)

. "$PSScriptRoot\_common.ps1"

if (-not $CsvPath) { $CsvPath = Join-Path $PilotData 'users.csv' }
if ($PasswordLength -lt 12 -or $PasswordLength -gt 64) { Stop-Pilot 'PasswordLength must be between 12 and 64.' 2 }
if (-not (Test-Path -LiteralPath $CsvPath)) {
    Stop-Pilot ("CSV not found: $CsvPath`n  Create it from the sample:  Copy-Item .\scripts\pilot\users.sample.csv .\pilot-data\users.csv   then edit it.") 2
}

$validRoles = @('member', 'editor', 'admin')
# Excel with a Vietnamese regional setting saves "CSV" with ';' as the separator: detect it.
$firstLine = [string](Get-Content -LiteralPath $CsvPath -Encoding UTF8 -TotalCount 1)
$delimiter = ','
if ($firstLine.Contains(';') -and -not $firstLine.Contains(',')) { $delimiter = ';' }
$rows = @(Import-Csv -LiteralPath $CsvPath -Encoding UTF8 -Delimiter $delimiter)
if ($rows.Count -eq 0) { Stop-Pilot "The CSV has no data rows: $CsvPath" 2 }
$columns = @($rows[0].PSObject.Properties | ForEach-Object { $_.Name })
if ($columns -notcontains 'username') { Stop-Pilot 'The CSV needs a header line: username,display_name,role' 2 }

# ---- validate everything first ------------------------------------------------
$problems = @()
$seen = @{}
$plan = @()
$lineNo = 1
foreach ($row in $rows) {
    $lineNo++
    $username = ([string]$row.username).Trim()
    $display = ''
    if ($columns -contains 'display_name') { $display = ([string]$row.display_name).Trim() }
    $role = ''
    if ($columns -contains 'role') { $role = ([string]$row.role).Trim().ToLower() }
    if (-not $role) { $role = 'member' }

    if (-not $username -and -not $display) { continue }   # blank line
    if (-not (Test-PilotUsername -Username $username)) {
        $problems += "line ${lineNo}: invalid username '$username' (2-63 chars: letters, digits, . _ @ -; must start with a letter or digit)"
    }
    if ($validRoles -notcontains $role) {
        $problems += "line ${lineNo}: invalid role '$role' for '$username' (use member, editor or admin)"
    }
    if ($display.Contains('"')) {
        $problems += "line ${lineNo}: display_name of '$username' contains a double quote, remove it"
    }
    if ($display.Length -gt 120) {
        $problems += "line ${lineNo}: display_name of '$username' is longer than 120 characters"
    }
    $key = $username.ToLower()
    if ($seen.ContainsKey($key)) { $problems += "line ${lineNo}: username '$username' appears twice (first on line $($seen[$key]))" }
    else { $seen[$key] = $lineNo }
    $plan += New-Object psobject -Property @{ Username = $username; DisplayName = $display; Role = $role }
}
if ($problems.Count -gt 0) {
    Write-Fail ('The CSV has ' + $problems.Count + ' problem(s); nothing was created:')
    $problems | ForEach-Object { Write-Host ('  ' + $_) }
    exit 2
}
if ($plan.Count -eq 0) { Stop-Pilot "No users found in $CsvPath" 2 }

Write-Step ('CSV ok: ' + $plan.Count + ' user(s)')
$adminCount = @($plan | Where-Object { $_.Role -eq 'admin' }).Count
Write-Host ('  roles: admin=' + $adminCount + ', editor=' + @($plan | Where-Object { $_.Role -eq 'editor' }).Count + ', member=' + @($plan | Where-Object { $_.Role -eq 'member' }).Count)

if ($DryRun) {
    $plan | ForEach-Object { Write-Host ('  would create ' + $_.Username + ' (' + $_.Role + ') ' + $_.DisplayName) }
    Write-Ok 'dry run only; nothing created'
    exit 0
}

Assert-DockerReady
Assert-PilotRunning
if (-not (Test-Path -LiteralPath $PilotSecrets)) { New-Item -ItemType Directory -Path $PilotSecrets | Out-Null }
$secretFile = Join-Path $PilotSecrets 'pilot-users.secret.csv'

# ---- create --------------------------------------------------------------------
$created = 0
$skipped = 0
$failed = 0
foreach ($u in $plan) {
    $password = New-PilotPassword -Length $PasswordLength
    $result = New-PilotUser -Username $u.Username -DisplayName $u.DisplayName -Role $u.Role -Password $password
    if ($result.Result -eq 'created') {
        try {
            Add-PilotSecretRow -Path $secretFile -Username $u.Username -DisplayName $u.DisplayName -Role $u.Role -Password $password
        }
        catch {
            # The user exists but the password could not be stored: say so loudly,
            # the fix is reset-password.ps1 (it writes a new secret row).
            Write-Fail ('user ' + $u.Username + ' was created but writing the secret file failed: ' + $_.Exception.Message +
                '  -> run reset-password.ps1 -Username ' + $u.Username)
            $failed++
            $password = $null
            continue
        }
        $created++
        Write-Ok ('created ' + $u.Username + ' (' + $u.Role + ')')
    }
    elseif ($result.Result -eq 'exists') {
        $skipped++
        Write-Warn2 ('skipped ' + $u.Username + ': already exists (password unchanged)')
    }
    else {
        $failed++
        Write-Fail ('failed ' + $u.Username + ': ' + $result.Message)
    }
    $password = $null
}

Write-Host ''
Write-Host ('Summary: created=' + $created + '  skipped(existing)=' + $skipped + '  failed=' + $failed)
if ($created -gt 0) {
    Write-Host ('Passwords are ONLY in: ' + $secretFile) -ForegroundColor Yellow
    Write-Host 'Give each user their password privately, then move or delete that file. It is gitignored.' -ForegroundColor Yellow
}
if ($failed -gt 0) { exit 1 }
exit 0
