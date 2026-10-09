// # Verifies the web application consumes the shared ApiError envelope contract
import { ApiError } from '@wlct/utils/api-error';

describe('shared ApiError', () => {
  it('parses the API envelope and retains only well-formed field details', () => {
    const error = ApiError.fromBody(422, {
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Check the request.',
        details: [
          { field: 'email', message: 'Invalid email.' },
          { field: 'amount', message: 'Must be a decimal string.' },
          { field: 7, message: 'Malformed detail is ignored.' },
        ],
        requestId: 'request-123',
      },
    });

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(422);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toBe('Check the request.');
    expect(error.requestId).toBe('request-123');
    expect(error.fieldErrors).toEqual({
      email: 'Invalid email.',
      amount: 'Must be a decimal string.',
    });
  });

  it('returns a generic error for malformed payloads without throwing', () => {
    expect(ApiError.fromBody(500, null)).toMatchObject({
      status: 500,
      code: 'UNKNOWN_ERROR',
      message: 'The request could not be completed.',
    });
    expect(ApiError.fromBody(500, { error: ['bad'] }).details).toBeUndefined();
  });

  it('identifies authentication failures by status and token code', () => {
    expect(ApiError.fromBody(401, { error: { code: 'UNAUTHORIZED' } }).isAuthError).toBe(true);
    expect(ApiError.fromBody(403, { code: 'TOKEN_EXPIRED' }).isAuthError).toBe(true);
    expect(ApiError.fromBody(500, { code: 'SERVER_ERROR' }).isAuthError).toBe(false);
  });
});
