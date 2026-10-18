# Shared WSL2 validation. Dot-source only from the reviewed local package.
function Assert-ResetWsl2([string]$Distro) {
  if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { throw 'wsl.exe was not found. Install and configure a user-owned WSL2 distribution first.' }
  $text = (& wsl.exe --list --verbose 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) { throw 'Could not inspect installed WSL distributions.' }
  $text = $text -replace "`0", ''
  $lines = @($text -split "`r?`n" | Where-Object { $_.Trim() })
  if ([string]::IsNullOrWhiteSpace($Distro)) {
    $entry = $lines | Where-Object { $_ -match '^\s*\*' }
    if (-not $entry -or $entry -notmatch '\s2\s*$') { throw 'The default distribution is not confirmed as WSL2; supply -Distro with an installed WSL2 distribution.' }
  } else {
    $escaped = [regex]::Escape($Distro)
    $entry = $lines | Where-Object { $_ -match "^\s*\*?\s*$escaped\s+.+\s+2\s*$" }
    if (-not $entry) { throw 'The selected distribution is not confirmed as an installed WSL2 distribution.' }
  }
}
