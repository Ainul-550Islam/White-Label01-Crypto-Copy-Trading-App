// # Responsibility: verifies audit reads are bound to the authenticated actor and tenant scope.
// # Audit controller regression tests for actor identity and tenant-scoped customer activity reads.
import type { AuthenticatedActor } from '@wlct/shared-types';

import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { ListAuditLogsDto } from './dto/list-audit-logs.dto';

describe('AuditController', () => {
  describe('listMyActivity', () => {
    it('forces the authenticated user and request tenant over caller-supplied audit filters', async () => {
      const list = jest.fn().mockResolvedValue({ items: [], pagination: {} });
      const controller = new AuditController({ list } as unknown as AuditService);
      const query = new ListAuditLogsDto();
      query.actorId = 'attacker-supplied-actor';
      query.tenantId = 'attacker-supplied-tenant';
      query.action = 'USER_LOGIN_SUCCEEDED';

      const actor: AuthenticatedActor = {
        userId: 'authenticated-user-id',
        tenantId: 'authenticated-tenant-id',
        sessionId: 'authenticated-session-id',
        roles: ['CUSTOMER'],
        permissions: [],
        isPlatformUser: false,
        tokenId: 'authenticated-token-id',
      };

      await controller.listMyActivity(query, actor.tenantId, actor);

      expect(list).toHaveBeenCalledWith({
        ...query,
        tenantId: actor.tenantId,
        actorId: actor.userId,
      });
    });
  });
});
