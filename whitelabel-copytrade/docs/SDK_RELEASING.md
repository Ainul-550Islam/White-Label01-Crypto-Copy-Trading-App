# SDK versioning, compatibility, and release procedure

This guide covers the Python package `wlct-sdk` and the TypeScript package `@wlct/sdk-typescript`. It is a maintainer checklist, not a release approval. Both packages are proprietary; publishing or distributing them requires authorization from the software owner.

## 1. Sources of truth

- `docs/openapi/openapi.json` is the committed API contract used to generate both SDKs.
- The API implementation and `openapi:export` command produce or refresh that contract. Exporting a new contract is a separate API change; generated SDK files must not be used to conceal API drift.
- Generated SDK models and event catalogs are checked in. Do not edit generated files manually. Change the OpenAPI source, regenerate, inspect the diff, and run the read-only drift checks.
- Webhook event names and payload schemas are part of the public contract. The generated catalogs must agree with the backend event catalog and the OpenAPI schemas before release.

## 2. Versioning and compatibility

SDK package versions are tracked separately from API contract compatibility. Each package has its own version in its package metadata and its own `CHANGELOG.md`; update both together for a package release.

Use Semantic Versioning for package versions:

- **Patch:** compatible bug fixes, documentation corrections, or generated output that does not remove or change the meaning of a public API.
- **Minor:** backward-compatible additions to client methods, models, event catalogs, or supported API capabilities.
- **Major:** a breaking SDK surface change, including removed or renamed public members, incompatible type changes, or behavior changes that invalidate existing callers.

An API-contract change is not automatically an SDK major release. Review its effect on existing consumers and supported API versions separately. Do not remove a route, field, event, or payload shape from a supported contract without an explicit deprecation plan and owner approval. This repository does not declare a fixed deprecation duration; agree and document the support window before announcing a breaking API change.

## 3. Release checklist

1. **Review the API change.** Confirm that the committed OpenAPI document represents the intended backend contract. If it changed, review the endpoint, authentication, tenant scoping, error responses, and webhook event changes with the API owners.
2. **Regenerate and verify TypeScript output.** From the repository root run:

   ```sh
   npm run generate --workspace=@wlct/sdk-typescript
   npm run generate:check --workspace=@wlct/sdk-typescript
   npm run build --workspace=@wlct/sdk-typescript
   npm test --workspace=@wlct/sdk-typescript
   ```

   The package's `prepublishOnly` script also runs build, tests, and the generated-file check.
3. **Regenerate and verify Python output.** Install the SDK's development extra, then run:

   ```sh
   python -m pip install -e 'packages/sdk-python[dev]'
   python packages/sdk-python/scripts/generate.py
   python packages/sdk-python/scripts/generate.py --check
   python -m pytest -q packages/sdk-python/tests
   ```

4. **Check contract drift.** Run the repository's OpenAPI export/drift and webhook catalog checks required by CI. If the API project cannot complete its required validation gates, record that blocker; a passing SDK-only build does not certify the API.
5. **Review the package diff.** Confirm that generated files are deterministic; only intended source, generated output, changelog, and version metadata changed; no credentials, environment values, or local build artifacts were included; and the Python and TypeScript event catalogs agree.
6. **Update changelogs and versions.** Record user-visible additions, fixes, deprecations, compatibility notes, and the package version in each package's `CHANGELOG.md` and metadata. Do not claim compatibility beyond the contract and tests actually verified.
7. **Obtain release authorization.** Confirm proprietary-distribution approval, target registry, package ownership, access scope, and version availability. The TypeScript package configures restricted npm access; the Python package declares a proprietary license. Never publish either package to a public registry without written authorization.
8. **Publish and verify.** Use the owner-approved CI or registry procedure, publish the reviewed version once, then install the published artifact in a clean environment and verify package contents, version, imports, generated types, and checksums. Do not reuse or overwrite an immutable release version.

## 4. Release boundaries

- The TypeScript package's `prepublishOnly` gate runs its build, tests, and generation check. The Python package has a generation check and tests; this repository does not configure an automatic Python registry-publishing workflow in the package metadata.
- A generated-file drift check proves only that committed output matches the committed OpenAPI input. It does not prove that the API implementation matches that contract, that a live endpoint is available, or that an SDK release has been authorized.
- API credential, tenant, order, wallet, or trading behavior must not be inferred from SDK types. The SDK is a client contract surface, not an authorization boundary or a substitute for server-side validation.
- If a release gate fails, report the exact command and result and stop the release. Do not bypass the gate by editing generated output, disabling tests, or silently changing the contract source.
