# WLCT Developer Platform TypeScript SDK

This package provides the typed TypeScript client for the WLCT developer-platform API. Request methods use the backend's documented routes; webhook verification validates the signature over the exact raw request body.

## Install

```sh
npm install @wlct/sdk-typescript
```

The package is proprietary and is distributed only under a separate written agreement with the software owner.

## Contract types

The `components`, `operations`, and `paths` types are generated from `docs/openapi/openapi.json`. `DEVELOPER_EVENT_TYPES` is generated from the same schema, so a backend event addition cannot silently leave the SDK catalog stale.

```ts
import {
  DEVELOPER_EVENT_TYPES,
  DeveloperPlatformClient,
  type components,
} from '@wlct/sdk-typescript';

const client = new DeveloperPlatformClient({
  baseUrl: 'https://api.example.test',
  auth: { kind: 'bearer', token: process.env.WLCT_ACCESS_TOKEN ?? '' },
});

const supportedEvents: readonly string[] = DEVELOPER_EVENT_TYPES;
type WebhookEnvelope = components['schemas']['DeveloperWebhookEventEnvelope'];
```

Generated files are updated with `npm run generate --workspace @wlct/sdk-typescript`. CI and prepublish run the read-only `generate:check` mode and fail if the committed files differ from the OpenAPI contract.

## Releases

See [`docs/SDK_RELEASING.md`](../../docs/SDK_RELEASING.md) for versioning, API compatibility, deprecation, and registry release controls.
