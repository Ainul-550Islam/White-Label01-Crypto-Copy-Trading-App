#!/usr/bin/env bash
# Apply Batch 04 new files and reviewed unified patches to the repository checkout.
set -euo pipefail
BATCH_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(git -C "$BATCH_DIR" rev-parse --show-toplevel)"
PROJECT_ROOT="$REPO_ROOT/whitelabel-copytrade"
if [[ -d "$BATCH_DIR/apps" ]]; then
  mkdir -p "$PROJECT_ROOT/apps"
  cp -a "$BATCH_DIR/apps/." "$PROJECT_ROOT/apps/"
fi
cd "$REPO_ROOT"
for patch in "$BATCH_DIR"/_apply/*.batch04.patch; do
  git apply --check "$patch"
  git apply --3way "$patch"
done
