// # Verifies admin-web consumes the same shared ApiError implementation as customer web
import { ApiError } from '@wlct/utils/api-error';

describe('shared ApiError in admin-web', () => {
  it('preserves the API code, request id, and form field details', () => {
    const error = ApiError.fromBody(400, {
      error: {
        code: 'INVALID_INPUT',
        message: 'The request is invalid.',
        details: [{ field: 'tenantId', message: 'Required.' }],
        requestId: 'admin-request-456',
      },
    });

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.requestId).toBe('admin-request-456');
    expect(error.fieldErrors).toEqual({ tenantId: 'Required.' });
  });
});
