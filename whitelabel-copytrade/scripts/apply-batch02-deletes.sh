#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(git -C "$script_dir" rev-parse --show-toplevel)"
cd "$repo_root"
git rm --ignore-unmatch -- whitelabel-copytrade/apps/admin-web/src/middleware.ts
git rm --ignore-unmatch -- whitelabel-copytrade/apps/api/src/modules/auth/account-recovery.adapters.ts
