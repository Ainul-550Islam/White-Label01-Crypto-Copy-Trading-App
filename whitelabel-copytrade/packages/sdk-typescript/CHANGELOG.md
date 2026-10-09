# Changelog

All notable changes to this SDK are documented here. Versions follow Semantic Versioning. API compatibility is tracked separately from the SDK package version; see `docs/SDK_RELEASING.md`.

## [1.0.0] - 2026-10-09

### Added

- Generated OpenAPI TypeScript types and runtime webhook event constants from `docs/openapi/openapi.json`.
- A generated-type drift check required by build, typecheck, tests, and prepublish.
- Type definitions for the webhook event envelope and every versioned payload schema in the committed contract.

### Changed

- The SDK event catalog now includes every event in the backend's versioned catalog.
