# Responsibility: explain the CI security gates, local commands, and safe handling of findings.

# Security checks in CI

The repository-root workflow at `../.github/workflows/infra.yml` is the workflow GitHub executes. The copy at `.github/workflows/infra.yml` preserves the same job definitions for checkouts that treat `whitelabel-copytrade` as their root. All `uses:` actions in these workflows are pinned to full commit SHAs.

## Gates

- **Gitleaks tree and history:** downloads Gitleaks v8.21.2, verifies the pinned SHA-256 before extraction, and invokes `scripts/secret-scan.mjs --tree` and `--history`. The runner exits non-zero when Gitleaks is missing or fails to produce a report; a scan that did not run cannot pass. The job also runs `scripts/secret-scan.test.mjs` with the pinned binary, including a clean-tree scan and a planted-token detection test. The root `.gitleaks.toml` permits only reviewed, exact synthetic values and contains no broad path or rule suppressions.
- **npm dependency audit:** runs `scripts/check-dependency-audit.mjs`, which checks the npm audit result against the expiring, reviewed baseline. New, more severe, expired, and stale exceptions fail. The job also checks that the committed SPDX SBOM is current.
- **Python dependency audit:** installs pip-audit at a fixed version and audits every service `requirements.txt` found under `services/`, plus the runtime dependency list in `libs/trading-core/pyproject.toml`.
- **Trivy filesystem scan:** scans the source tree, dependency manifests, Dockerfiles, and infrastructure for vulnerabilities, misconfiguration, and secrets. HIGH or CRITICAL findings with a fix available fail the job.

## Run locally

From the project root, install Gitleaks v8.21.2 and verify the same SHA-256 used by the workflow. Then set `GITLEAKS_BINARY` to that executable and run:

```bash
export GITLEAKS_BINARY=/absolute/path/to/gitleaks
node scripts/secret-scan.mjs --tree
node scripts/secret-scan.mjs --history
node --test scripts/secret-scan.test.mjs

npm ci --ignore-scripts --no-audit --no-fund
node scripts/check-dependency-audit.mjs
node scripts/generate-sbom.mjs --check whitelabel-sbom.spdx.json

python3 -m pip install pip-audit==2.7.3
mapfile -t requirements < <(find services -mindepth 2 -maxdepth 2 -type f -name requirements.txt -print | sort)
test "${#requirements[@]}" -gt 0
for file in "${requirements[@]}"; do
  python3 -m pip_audit -r "$file"
done
generated_requirements="$(mktemp)"
trap 'rm -f "$generated_requirements"' EXIT
python3 - <<'PY' > "$generated_requirements"
import pathlib
import tomllib

project = tomllib.loads(pathlib.Path("libs/trading-core/pyproject.toml").read_text())
for dependency in project["project"].get("dependencies", []):
    print(dependency)
PY
python3 -m pip_audit -r "$generated_requirements"

# Trivy must be installed locally or run using its pinned container image.
docker run --rm -v "$PWD:/src:ro" aquasec/trivy:0.57.1 fs \
  --scanners vuln,misconfig,secret \
  --ignore-unfixed \
  --severity HIGH,CRITICAL \
  --exit-code 1 \
  /src
```

A missing tool, failed download, checksum mismatch, or scanner error is a blocked check, not a clean result. Do not manually report a blocked check as passed.

## Responding to a finding

1. Preserve the scanner output and identify the exact file, package, advisory, and affected version.
2. For an exposed credential, revoke or rotate it first; do not copy the value into an issue, log, PR, or exception file.
3. Upgrade the vulnerable dependency or image to a supported fixed version and rerun the same gate.
4. A dependency exception requires a documented reason, severity ceiling, owner review, and expiry in `ops/security/dependency-audit-baseline.json`; never create an indefinite exception to make CI green.
5. A synthetic fixture can be allowlisted only as the exact secret value after review. Never add a broad path, regex, or rule suppression.
