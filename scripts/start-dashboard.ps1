# Start RESET's read-only loopback dashboard through WSL2/Linux.
[CmdletBinding()]
param(
  [string]$Distro
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
function Fail([string]$Message) { throw "RESET dashboard failed: $Message" }
. (Join-Path $PSScriptRoot 'wsl-common.ps1')
Assert-ResetWsl2 $Distro
$command = 'cd "$HOME/.local/share/resetmnr" && node bin/check-install.mjs && unset RESET_ADDRESS && export RESET_GATEWAY_URL=https://reset.openmayhem.ai && exec node "$HOME/.local/share/resetmnr/vendor/upstream/signer/bin/reset-signer.mjs" dashboard --port 4747 --directory "$HOME/.reset-signer"'
$wslArgs = @()
if (-not [string]::IsNullOrEmpty($Distro)) { $wslArgs += @('-d', $Distro) }
$wslArgs += @('--exec', 'bash', '-lc', $command)
& wsl.exe @wslArgs
if ($LASTEXITCODE -ne 0) { Fail "WSL dashboard process exited with code $LASTEXITCODE." }
