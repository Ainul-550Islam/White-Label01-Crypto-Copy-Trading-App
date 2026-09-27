"""wlct_sdk — production Python SDK for the white-label developer platform.

Exports the typed client, credential models, pagination, normalized errors
and the webhook signature verifier. Credentials are accepted as constructor
arguments only and are never logged by this package.
"""

from .client import (
    APPLICATION_STATES,
    DEVELOPER_EVENT_TYPES,
    DEVELOPER_SCOPES,
    BearerCredentials,
    DeveloperApiError,
    DeveloperKeyCredentials,
    DeveloperPlatformClient,
    Page,
    verify_webhook,
)

__version__ = "1.0.0"

__all__ = [
    "DeveloperPlatformClient",
    "DeveloperApiError",
    "BearerCredentials",
    "DeveloperKeyCredentials",
    "Page",
    "verify_webhook",
    "APPLICATION_STATES",
    "DEVELOPER_SCOPES",
    "DEVELOPER_EVENT_TYPES",
    "__version__",
]
