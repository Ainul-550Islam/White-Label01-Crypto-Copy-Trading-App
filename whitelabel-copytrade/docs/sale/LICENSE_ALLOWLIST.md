# Third-Party License Allowlist

This file is the reviewed exception register consumed by `scripts/license-gate.mjs`. It is intentionally empty until a package-specific legal review approves an exception. The gate fails closed when the table is malformed, an exception is missing a reason, or an entry no longer matches a shipped SBOM component.

Add one row per exact package URL and exact SPDX license expression. Include a concrete rationale, the approving owner, and a review date in `YYYY-MM-DD` format. Do not use wildcard package names, ranges, or blanket ecosystem approvals.

| Package URL (PURL) | SPDX license expression | Reason | Approved by | Review date |
| --- | --- | --- | --- | --- |
