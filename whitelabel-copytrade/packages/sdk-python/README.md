# WLCT Developer Platform Python SDK

`wlct-sdk` is the Python client for the WLCT developer-platform API. It provides injectable HTTP transport, bearer/developer-key authentication, safe GET retries, cursor pagination, normalized API errors, and raw-body webhook-signature verification.

## Install

The package is proprietary and is released only to authorized customers through the approved private distribution channel. Do not publish it to a public index.

## Quick start

```python
from wlct_sdk import BearerCredentials, DeveloperPlatformClient

client = DeveloperPlatformClient(
    base_url="https://api.example.test",
    credentials=BearerCredentials(token="replace-with-a-short-lived-token"),
)
page = client.list_applications()
for application in page.rows:
    print(application["id"])
```

Generated Pydantic request/response models are available from `wlct_sdk.generated.models`. `wlct_sdk.DEVELOPER_EVENT_TYPES` is generated from `docs/openapi/openapi.json` alongside those models.

## Contract generation and verification

From the repository root, install the package's development extras and generate or verify the committed OpenAPI output:

```sh
python -m pip install -e 'packages/sdk-python[dev]'
python packages/sdk-python/scripts/generate.py
python packages/sdk-python/scripts/generate.py --check
```

The test suite and release checks run the read-only drift check and fail when generated files do not match the committed OpenAPI document.

See [`docs/SDK_RELEASING.md`](../../docs/SDK_RELEASING.md) for versioning, compatibility, deprecation, and distribution controls.
