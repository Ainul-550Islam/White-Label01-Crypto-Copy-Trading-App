# Changelog

All notable changes to this SDK are documented here. Versions follow Semantic Versioning. API compatibility is tracked separately from the SDK package version; see `docs/SDK_RELEASING.md`.

## [1.0.0] - 2026-10-09

### Added

- Generated Pydantic models for the committed OpenAPI contract.
- A generated Python webhook event catalog consumed by the SDK's public export.
- A read-only code-generation drift check required by the test and release workflow.

### Changed

- The Python SDK event catalog now follows the complete backend webhook catalog.
