import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { AuditAction } from '@wlct/shared-types';
import { AUDIT_ACTION_KEY } from '../constants/metadata.constants';

/**
 * Declares the audit action produced by a route. The audit interceptor uses it
 * to emit a record automatically when the handler resolves successfully.
 */
export const Audited = (action: AuditAction, resourceType?: string): CustomDecorator<string> =>
  SetMetadata(AUDIT_ACTION_KEY, { action, resourceType });
