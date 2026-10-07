// # Responsibility: proves authenticated preview access, tenant/user selector rejection, permission metadata, and unverified-input provenance.

import { ForbiddenException } from '@nestjs/common';
import { Permission } from '@wlct/shared-types';
import { PERMISSIONS_KEY } from '../../common/constants/metadata.constants';
import { AllocationRebalanceController } from './allocation-rebalance.controller';
import { AllocationRebalanceService } from './allocation-rebalance.service';
import { AllocationRebalancePreviewDto } from './dto/allocation-rebalance.dto';

describe('AllocationRebalanceController', () => {
  const serviceResult = {
    totalValue: '100',
    lines: [],
    executable: false as const,
    reason: 'Preview only; no order or transfer has been created.',
  };
  const preview = jest.fn().mockReturnValue(serviceResult);
  const controller = new AllocationRebalanceController({ preview } as unknown as AllocationRebalanceService);
  const dto: AllocationRebalancePreviewDto = {
    totalValue: '100',
    allocations: [
      { traderId: 'trader-a', currentValue: '100', targetWeightBps: 10_000, priceAvailable: true },
    ],
  };

  beforeEach(() => preview.mockClear());

  it('requires the declared strategy-read permission at handler level', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AllocationRebalanceController.prototype.preview)).toEqual([
      Permission.STRATEGY_READ,
    ]);
  });

  it('labels every result as non-executable and client-supplied even when a request includes tenant selectors', () => {
    const request = {
      user: { tenantId: 'tenant-from-token', userId: 'user-from-token' },
      headers: { 'x-tenant-id': 'attacker-tenant' },
    };
    const dtoWithUntrustedSelectors = {
      ...dto,
      tenantId: 'attacker-tenant',
      userId: 'attacker-user',
    } as AllocationRebalancePreviewDto;

    expect(controller.preview(request, dtoWithUntrustedSelectors)).toEqual({
      ...serviceResult,
      inputProvenance: 'CLIENT_SUPPLIED_UNVERIFIED',
    });
    expect(preview).toHaveBeenCalledWith({ totalValue: '100', allocations: dto.allocations });
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it('denies requests without a verified tenant or authenticated user', () => {
    expect(() => controller.preview({ user: { userId: 'user-a' } }, dto)).toThrow(ForbiddenException);
    expect(() => controller.preview({ user: { tenantId: 'tenant-a' } }, dto)).toThrow(ForbiddenException);
    expect(preview).not.toHaveBeenCalled();
  });
});
