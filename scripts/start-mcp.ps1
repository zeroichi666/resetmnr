# Start RESET MCP through the supported WSL2/Linux install.
[CmdletBinding()]
param(
  [string]$Distro
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
function Fail([string]$Message) { throw "RESET MCP failed: $Message" }
. (Join-Path $PSScriptRoot 'wsl-common.ps1')
Assert-ResetWsl2 $Distro
$oldWslEnv = [Environment]::GetEnvironmentVariable('WSLENV', 'Process')
$oldPassword = [Environment]::GetEnvironmentVariable('RESET_SIGNER_PASSWORD', 'Process')
$password = $oldPassword
try {
  if ([string]::IsNullOrEmpty($password)) {
    if ([Console]::IsInputRedirected) { Fail 'RESET_SIGNER_PASSWORD is missing and console input is redirected; provide it in the inherited process environment.' }
    $secure = Read-Host 'Enter RESET signer password (hidden)' -AsSecureString
    $bstr = [IntPtr]::Zero
    try { $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) } }
    $env:RESET_SIGNER_PASSWORD = $password
  }
  if ([string]::IsNullOrEmpty($password)) { Fail 'A non-empty RESET_SIGNER_PASSWORD is required.' }
  $parts = @()
  if (-not [string]::IsNullOrEmpty($oldWslEnv)) { $parts = @($oldWslEnv -split ':' | Where-Object { $_ -and ($_ -notmatch '^RESET_SIGNER_PASSWORD([/:].*)?$') }) }
  $env:WSLENV = (($parts + 'RESET_SIGNER_PASSWORD') -join ':')
  $command = 'exec node "$HOME/.local/share/resetmnr/bin/reset-safe.mjs"'
  $wslArgs = @()
  if (-not [string]::IsNullOrEmpty($Distro)) { $wslArgs += @('-d', $Distro) }
  $wslArgs += @('--exec', 'bash', '-lc', $command)
  & wsl.exe @wslArgs
  if ($LASTEXITCODE -ne 0) { Fail "WSL MCP process exited with code $LASTEXITCODE." }
} finally {
  $password = $null
  if ($null -eq $oldPassword) { Remove-Item Env:RESET_SIGNER_PASSWORD -ErrorAction SilentlyContinue } else { $env:RESET_SIGNER_PASSWORD = $oldPassword }
  if ($null -eq $oldWslEnv) { Remove-Item Env:WSLENV -ErrorAction SilentlyContinue } else { $env:WSLENV = $oldWslEnv }
}
