import 'reflect-metadata';
import { DeveloperController } from './developer.controller';
import { PERMISSIONS_KEY } from '../../common/constants/metadata.constants';

describe('OAuth self-service boundary', () => {
  it('allows an authenticated subject rather than requiring developer management', () => {
    for (const method of ['oauthAuthorize', 'oauthConsent', 'oauthIssueCode', 'oauthGrants', 'oauthRevokeGrant'] as const) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, DeveloperController.prototype[method])).toEqual([]);
    }
  });
  it('keeps developer management protected', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, DeveloperController.prototype.createApplication)).not.toEqual([]);
  });
});
