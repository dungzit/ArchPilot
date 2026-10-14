<#
.SYNOPSIS
  Set a new random password for an existing pilot user (lost password, or a secret row was not saved).

.DESCRIPTION
  Generates a 16-character password, applies it through scripts\pilot\reset_password.py inside the
  container (password on STDIN only), revokes the user's active sessions, and appends the new
  password to pilot-data\secrets\pilot-password-resets.secret.csv (gitignored). Never prints it.

.PARAMETER Username
  The existing username.

.EXAMPLE
  .\scripts\pilot\reset-password.ps1 -Username an.nguyen
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Username,
    [int]$PasswordLength = 16
)

. "$PSScriptRoot\_common.ps1"

if (-not (Test-PilotUsername -Username $Username)) { Stop-Pilot "Invalid username: $Username" 2 }
if ($PasswordLength -lt 12 -or $PasswordLength -gt 64) { Stop-Pilot 'PasswordLength must be between 12 and 64.' 2 }
Assert-DockerReady
Assert-PilotRunning

$password = New-PilotPassword -Length $PasswordLength
$previous = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    $lines = $password | & docker exec -i $PilotContainer python /pilot/reset_password.py $Username 2>&1 | ForEach-Object { [string]$_ }
    $code = [int]$LASTEXITCODE
}
finally {
    $ErrorActionPreference = $previous
}
$message = ''
if ($lines) { $message = (($lines | Out-String).Trim()) }

if ($code -eq 3) { Stop-Pilot ('No such user: ' + $Username + '. ' + $message) 3 }
if ($code -ne 0) { Stop-Pilot ('Password reset failed (exit ' + $code + '): ' + $message) 1 }

$secretFile = Join-Path $PilotSecrets 'pilot-password-resets.secret.csv'
Add-PilotSecretRow -Path $secretFile -Username $Username -DisplayName '' -Role '' -Password $password
$password = $null
Write-Ok $message
Write-Host ('New password is ONLY in: ' + $secretFile) -ForegroundColor Yellow
exit 0
