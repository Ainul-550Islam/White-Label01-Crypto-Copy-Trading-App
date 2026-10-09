// # Responsibility: proves GET /v1/risk-management/leverage-policy resolves the two real ceilings and fails closed on every unknown.
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { RiskManagementController } from './risk.controller';
import { LeveragePolicyService } from '../risk/leverage-policy.service';

/**
 * `LeveragePolicyService` had a spec and no caller: the effective leverage ceiling existed as a rule
 * with no surface, so a customer could not ask what they were allowed before they traded. These
 * tests pin the wiring, not the arithmetic - the arithmetic is the service's own spec.
 *
 * The controller takes twenty dependencies, most of which this route does not touch. They are passed
 * as empty objects deliberately: if the route starts reading one of them, the test fails rather than
 * silently changing behaviour.
 */
describe('RiskManagementController leverage policy route', () => {
  const TENANT = 'tenant-a';

  function build(options: {
    account?: unknown;
    policy?: unknown;
    evaluate?: jest.Mock;
  } = {}) {
    const prisma = {
      tradingAccount: {
        findFirst: jest.fn(async () => (options.account === undefined ? null : options.account)),
      },
    };
    const policyService = {
      resolveEffectivePolicy: jest.fn(async () =>
        options.policy ?? { thresholds: { maxLeverageAccount: '5', maxLeverageGross: '10' } },
      ),
    };
    const evaluate =
      options.evaluate ??
      jest.fn(() => ({ allowed: true, effectiveMaximum: 5, requestedLeverage: 3, marginMode: 'CROSS', reason: null }));
    const leveragePolicyService = { evaluate } as unknown as LeveragePolicyService;

    const controller = new RiskManagementController(
      prisma as never, // prisma
      {} as never, // decisionService
      policyService as never, // policyService
      {} as never, // exposureService
      {} as never, // positionService
      {} as never, // marginService
      {} as never, // leverageService
      leveragePolicyService, // leveragePolicyService
      {} as never, // liquidationService
      {} as never, // concentrationService
      {} as never, // drawdownService
      {} as never, // dailyLossService
      {} as never, // correlationService
      {} as never, // varService
      {} as never, // stressService
      {} as never, // snapshotRepo
      {} as never, // breakerService
      {} as never, // killSwitchService
      {} as never, // reconciliationService
      {} as never, // customerExposureService
    );

    return { controller, prisma, policyService, evaluate };
  }

  const req = { user: { tenantId: TENANT } };

  test('evaluates against the tenant policy ceiling and the venue capability, scoped to the caller tenant', async () => {
    const { controller, prisma, evaluate } = build({
      account: { id: 'acct-1', tenantId: TENANT, canTrade: true, exchange: { maxLeverage: 20 } },
    });

    const result = await controller.getLeveragePolicy(req, 'acct-1', '3', 'CROSS');

    // The account lookup is tenant-scoped: a foreign account id must not resolve here.
    expect(prisma.tradingAccount.findFirst).toHaveBeenCalledWith({
      where: { id: 'acct-1', tenantId: TENANT },
      include: { exchange: true },
    });
    expect(evaluate).toHaveBeenCalledWith({
      requestedLeverage: 3,
      maximumAllowed: 5,
      venueMaximum: 20,
      marginMode: 'CROSS',
      accountCanTrade: true,
    });
    expect(result.policyCeiling).toBe('5');
    expect(result.venueCeiling).toBe('20');
  });

  test('falls back to the gross policy ceiling when no account-scoped ceiling is configured', async () => {
    const { controller, evaluate } = build({
      account: { id: 'acct-1', tenantId: TENANT, canTrade: true, exchange: { maxLeverage: 20 } },
      policy: { thresholds: { maxLeverageAccount: null, maxLeverageGross: '7' } },
    });

    await controller.getLeveragePolicy(req, 'acct-1', '3', 'CROSS');

    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ maximumAllowed: 7, venueMaximum: 20 }));
  });

  test('passes an unusable policy ceiling through as a refusal rather than inventing a limit', async () => {
    const { controller, evaluate } = build({
      account: { id: 'acct-1', tenantId: TENANT, canTrade: true, exchange: { maxLeverage: 20 } },
      policy: { thresholds: { maxLeverageAccount: '5.5', maxLeverageGross: '5.5' } },
    });

    await controller.getLeveragePolicy(req, 'acct-1', '3', 'CROSS');

    // 0 is the service's sentinel for "no valid ceiling supplied", which it turns into a refusal
    // naming the policy. Rounding 5.5 to 6 would be inventing a ceiling nobody configured.
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ maximumAllowed: 0 }));
  });

  test('reports a missing venue capability as null instead of assuming a limit', async () => {
    const { controller, evaluate } = build({
      account: { id: 'acct-1', tenantId: TENANT, canTrade: true, exchange: null },
    });

    const result = await controller.getLeveragePolicy(req, 'acct-1', '3', 'CROSS');

    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ venueMaximum: null }));
    expect(result.venueCeiling).toBeNull();
  });

  test('an account without trade capability is evaluated as unable to trade', async () => {
    const { controller, evaluate } = build({
      account: { id: 'acct-1', tenantId: TENANT, canTrade: false, exchange: { maxLeverage: 20 } },
    });

    await controller.getLeveragePolicy(req, 'acct-1', '3', 'CROSS');

    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ accountCanTrade: false }));
  });

  test('an unknown account is a 404 and never reaches the policy evaluation', async () => {
    const { controller, evaluate } = build({ account: null });

    await expect(controller.getLeveragePolicy(req, 'acct-missing', '3', 'CROSS')).rejects.toBeInstanceOf(NotFoundException);
    expect(evaluate).not.toHaveBeenCalled();
  });

  test('a missing or non-positive requested leverage is refused before any lookup', async () => {
    const { controller, prisma, evaluate } = build();

    await expect(controller.getLeveragePolicy(req, 'acct-1', undefined, 'CROSS')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.getLeveragePolicy(req, 'acct-1', '0', 'CROSS')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.getLeveragePolicy(req, 'acct-1', '2.5', 'CROSS')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.tradingAccount.findFirst).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
  });

  test('an unrecognised margin mode is treated as CROSS, the venue default, rather than passed through', async () => {
    const { controller, evaluate } = build({
      account: { id: 'acct-1', tenantId: TENANT, canTrade: true, exchange: { maxLeverage: 20 } },
    });

    await controller.getLeveragePolicy(req, 'acct-1', '3', 'PORTFOLIO');

    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ marginMode: 'CROSS' }));
  });
});
