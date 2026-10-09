// # Responsibility: pins the RiskManagementModule wiring that `npm run check:api-di` catches at boot - a controller dependency must be provided by the module that declares the controller.
import 'reflect-metadata';

import { RiskManagementController } from './risk.controller';
import { RiskManagementModule } from './risk-management.module';
import { UserPositionLimitController } from './user-position-limit.controller';
import { CustomerExposureService } from './customer-exposure.service';
import { LeveragePolicyService } from '../risk/leverage-policy.service';

/**
 * Why this spec exists, and why the route spec did not catch this.
 *
 * `LeveragePolicyService` was written with its own spec and then injected into
 * `RiskManagementController` for the `leverage-policy` route, but it was never added to the module
 * that declares that controller. The route's own spec passes the controller its dependencies by
 * hand, so a mocked service satisfied the constructor no matter what the module declared: the test
 * proved the route and never proved the wiring. The gap was only visible at boot:
 *
 *     DI_FAIL Nest can't resolve dependencies of the RiskManagementController ...
 *     LeveragePolicyService at index [7]
 *
 * `npm run check:api-di` boots the real graph and is the runtime evidence for this fix. These
 * assertions are the in-suite pin on the same wiring, so jest fails next to the code instead of
 * only the release gate doing so. They read the metadata Nest itself reads, and they fail if the
 * provider line is removed (verified by mutation).
 */
describe('RiskManagementModule wiring', () => {
  const providers = (): unknown[] =>
    (Reflect.getMetadata('providers', RiskManagementModule) as unknown[] | undefined) ?? [];

  const controllers = (): unknown[] =>
    (Reflect.getMetadata('controllers', RiskManagementModule) as unknown[] | undefined) ?? [];

  const controllerDependencies = (): unknown[] =>
    (Reflect.getMetadata('design:paramtypes', RiskManagementController) as unknown[] | undefined) ??
    [];

  it('declares both of its controllers', () => {
    expect(controllers()).toEqual(
      expect.arrayContaining([RiskManagementController, UserPositionLimitController]),
    );
  });

  it('provides LeveragePolicyService, the dependency that stopped the API from booting', () => {
    expect(providers()).toContain(LeveragePolicyService);
  });

  it('provides the owner-scoped exposure service its routes inject', () => {
    expect(providers()).toContain(CustomerExposureService);
    expect(controllerDependencies()).toContain(CustomerExposureService);
  });

  it('resolves every class-typed RiskManagementController dependency except the global PrismaService', () => {
    // Nothing is exempt except PrismaService, which arrives from the global Prisma module - that
    // is why the boot check in `check:api-di` reaches index [7] before it fails rather than
    // stopping at index [0]. Every other constructor parameter must be one of this module's
    // providers, or the API does not start. The assertion is deliberately the complement (an
    // empty list of unresolved names) so an exemption cannot quietly widen.
    const declared = new Set(providers());
    const unresolved = controllerDependencies().filter((token) => {
      if (typeof token !== 'function') return false;
      if (declared.has(token)) return false;
      return (token as { name: string }).name !== 'PrismaService';
    });

    expect(unresolved.map((token) => (token as { name: string }).name)).toEqual([]);
  });
});
