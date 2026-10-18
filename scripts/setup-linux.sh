#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
UPSTREAM="$ROOT/vendor/upstream"
WALLET="$HOME/.reset-signer"
case "$ROOT:$HOME" in /mnt/*|*:/mnt/*) echo 'Use the Linux home filesystem, not a Windows-mounted path.' >&2; exit 1 ;; esac
PIN='6132e8653d6342f36673eb7426ec8e064960e48e'
UPSTREAM_REPO='https://github.com/Trac-Systems/reset.git'
INITIALIZE=0
if [[ "${1:-}" == '--initialize-wallet' && $# -eq 1 ]]; then INITIALIZE=1
elif [[ $# -ne 0 ]]; then echo 'Usage: setup-linux.sh [--initialize-wallet]' >&2; exit 2
fi
fail() { echo "RESET Linux setup failed: $*" >&2; exit 1; }
command -v git >/dev/null 2>&1 || fail 'git is required and is not auto-installed.'
command -v node >/dev/null 2>&1 || fail 'Node.js 24 or newer is required and is not auto-installed.'
command -v npm >/dev/null 2>&1 || fail 'npm is required and is not auto-installed.'
node_major=$(node -p 'process.versions.node.split(".")[0]')
[[ "$node_major" =~ ^[0-9]+$ && "$node_major" -ge 24 ]] || fail "Node.js 24 or newer is required (found $(node --version))."

mkdir -p "$ROOT/vendor"
if [[ -e "$UPSTREAM" ]]; then
  [[ -d "$UPSTREAM/.git" ]] || fail 'Existing vendor/upstream is not a Git repository; refusing to overwrite it.'
  [[ "$(git -C "$UPSTREAM" remote get-url origin 2>/dev/null || true)" == "$UPSTREAM_REPO" ]] || fail 'Existing vendor/upstream has the wrong origin; refusing to overwrite it.'
  [[ -z "$(git -C "$UPSTREAM" status --porcelain --untracked-files=all)" ]] || fail 'Existing vendor/upstream is dirty; refusing to use or modify it.'
  [[ "$(git -C "$UPSTREAM" rev-parse HEAD 2>/dev/null || true)" == "$PIN" ]] || fail 'Existing vendor/upstream is not at the required pinned commit; refusing to rewrite it.'
else
  git clone --no-tags "$UPSTREAM_REPO" "$UPSTREAM"
  git -C "$UPSTREAM" checkout --detach "$PIN"
fi
[[ "$(git -C "$UPSTREAM" rev-parse HEAD)" == "$PIN" ]] || fail 'Pinned upstream revision could not be verified.'
[[ -z "$(git -C "$UPSTREAM" status --porcelain --untracked-files=all)" ]] || fail 'Upstream checkout is dirty; refusing to continue.'
[[ -f "$UPSTREAM/signer/package-lock.json" ]] || fail 'Pinned upstream signer lockfile is missing.'
npm ci --prefix "$UPSTREAM/signer"
[[ -z "$(git -C "$UPSTREAM" status --porcelain --untracked-files=all -- signer)" ]] || fail 'npm ci changed pinned signer files; refusing to continue.'

if [[ -e "$WALLET" ]]; then
  [[ -d "$WALLET" && ! -L "$WALLET" ]] || fail 'Default wallet path is not a real directory.'
  [[ "$(stat -c '%u' "$WALLET")" == "$(id -u)" ]] || fail 'Default wallet directory is not owned by the current user.'
  mode=$((8#$(stat -c '%a' "$WALLET")))
  (( (mode & 077) == 0 )) || fail 'Default wallet directory is not private (group/other permissions must be absent).'
else
  if (( INITIALIZE == 0 )); then echo "Dependencies installed at $PIN. No wallet created; rerun with --initialize-wallet when ready."; exit 0; fi
  mkdir -m 700 "$WALLET"
fi
keystore="$WALLET/keystore.json"
if [[ -e "$keystore" ]]; then
  [[ -f "$keystore" && ! -L "$keystore" ]] || fail 'Existing keystore is not a regular non-symlink file.'
  [[ "$(stat -c '%u' "$keystore")" == "$(id -u)" ]] || fail 'Existing keystore is not owned by the current user.'
  mode=$((8#$(stat -c '%a' "$keystore")))
  (( (mode & 077) == 0 )) || fail 'Existing keystore is not private (group/other permissions must be absent).'
  (( INITIALIZE == 0 )) || fail 'A wallet already exists; initialization never overwrites it.'
  echo "Existing encrypted wallet preserved at $WALLET. No wallet migration was attempted."
elif (( INITIALIZE == 1 )); then
  if find "$WALLET" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then fail 'Wallet directory is non-empty without a keystore; refusing overwrite or migration.'; fi
  ( cd "$UPSTREAM" && node signer/bin/reset-signer.mjs init )
  [[ -f "$keystore" && ! -L "$keystore" ]] || fail 'Signer init returned success but no keystore was created.'
  mode=$((8#$(stat -c '%a' "$keystore")))
  (( (mode & 077) == 0 )) || fail 'Signer created a keystore with unsafe group/other permissions.'
  echo "Wallet initialized at $WALLET. The password was never written by this script."
else
  if find "$WALLET" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then fail 'Wallet directory has no keystore and is not empty; refusing migration or overwrite.'; fi
  echo 'No wallet created. Re-run with --initialize-wallet when ready.'
fi
echo "Setup complete. Upstream is pinned to $PIN and signer dependencies were installed with npm ci."
