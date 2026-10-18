# Windows bootstrap: reproduce this exact clean package revision inside WSL2.
[CmdletBinding()]
param(
  [string]$Distro,
  [switch]$InitializeWallet
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'wsl-common.ps1')
Assert-ResetWsl2 $Distro
function Fail([string]$Message) { throw "RESET WSL setup failed: $Message" }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'Git for Windows is required to verify this local package checkout.' }
$Root = Split-Path -Parent $PSScriptRoot
$headLines = & git -C $Root rev-parse HEAD
if ($LASTEXITCODE -ne 0) { Fail 'The local package must be a Git checkout, not an unversioned download.' }
$PackagePin = (($headLines -join "`n").Trim())
if ($PackagePin -notmatch '^[a-f0-9]{40}$') { Fail 'Invalid local package revision.' }
$dirtyLines = & git -C $Root status --porcelain --untracked-files=all
if ($LASTEXITCODE -ne 0) { Fail 'Could not inspect local package changes.' }
if (($dirtyLines -join "`n").Trim()) { Fail 'Local package checkout is modified. Review and commit changes before bootstrapping WSL.' }

# The commit and option are positional Bash arguments, never shell interpolation.
$command = @'
set -euo pipefail
root="$HOME/.local/share/resetmnr"
repo='https://github.com/zeroichi666/resetmnr.git'
package_pin="$1"
shift
[[ "$package_pin" =~ ^[a-f0-9]{40}$ ]] || exit 2
if [ -e "$root" ]; then
  [ -d "$root/.git" ] || { echo 'Existing package path is not a Git repository; refusing overwrite.' >&2; exit 1; }
  [ "$(git -C "$root" remote get-url origin)" = "$repo" ] || { echo 'Existing package origin differs; refusing overwrite.' >&2; exit 1; }
  [ -z "$(git -C "$root" status --porcelain --untracked-files=all)" ] || { echo 'Existing package is dirty; refusing changes.' >&2; exit 1; }
  [ "$(git -C "$root" rev-parse HEAD)" = "$package_pin" ] || { echo 'Existing Linux package revision differs from the Windows checkout; review it manually, no automatic replacement was made.' >&2; exit 1; }
else
  mkdir -p "$(dirname "$root")"
  git clone --no-tags "$repo" "$root"
  git -C "$root" checkout --detach "$package_pin"
fi
[ "$(git -C "$root" rev-parse HEAD)" = "$package_pin" ] || exit 1
cd "$root"
exec bash "$root/scripts/setup-linux.sh" "$@"
'@
$wslArgs = @()
if (-not [string]::IsNullOrWhiteSpace($Distro)) { $wslArgs += @('-d', $Distro) }
$wslArgs += @('--exec', 'bash', '-lc', $command, '--', $PackagePin)
if ($InitializeWallet) { $wslArgs += '--initialize-wallet' }
& wsl.exe @wslArgs
if ($LASTEXITCODE -ne 0) { Fail "Linux setup exited with code $LASTEXITCODE." }
