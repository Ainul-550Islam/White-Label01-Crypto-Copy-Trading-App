# Release package verification checklist

Use this checklist before publishing a release bundle. It is an operational checklist, not a declaration that any environment has passed.

- [ ] Confirm the working tree and release branch are the intended sources; do not include credentials, local configuration, build output, caches, or untracked artifacts unintentionally.
- [ ] Regenerate the deterministic release manifest from the package root and verify the manifest reports the expected commit, package set, file list, and file hashes.
- [ ] Run the documented schema, API contract, route-authorization, secret-scanning, and dependency-audit gates.
- [ ] Build and typecheck the admin and customer web applications, and verify the generated production CSS contains the configured Tailwind utilities.
- [ ] Run the relevant API, web, admin, Python service, and library tests. Record any command that could not run and the concrete environmental reason; do not mark a skipped check as passed.
- [ ] Review the generated SBOM and release artifacts, ensure they match the checked-in manifest inputs, and confirm no generated report or scratch file entered the package.
- [ ] Verify migration compatibility and restore/rollback instructions against a staging database before any production deployment.
