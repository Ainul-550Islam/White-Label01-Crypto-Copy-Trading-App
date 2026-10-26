// # Responsibility: retain RBAC while using verified actor/request identity, account-owner scope and validated venue/environment bindings; unavailable update/enable operations must not pretend to have persisted changes.
import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AppRequest } from '../../common/types/request.types';
import { Permission, hasPermission, type AuthenticatedActor } from '@wlct/shared-types';
import { RequireStepUp } from '../auth/step-up/require-step-up.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { ExchangeAccountService } from './exchange-account.service';
import { ExchangeConnectivityService } from './exchange-connectivity.service';
import { ExchangeBalanceSyncService } from './exchange-balance-sync.service';
import { ExchangePositionSyncService } from './exchange-position-sync.service';
import { ExchangeOrderSyncService } from './exchange-order-sync.service';
import { ExchangeHealthService } from './exchange-health.service';
import { ExchangeRateLimitService } from './exchange-rate-limit.service';
import { ExchangeSymbolService } from './exchange-symbol.service';
import { ExchangeRoutingService } from './exchange-routing.service';
import { ExchangeRegistryService } from './exchange-registry.service';
import { ExchangeProviderFactory } from './exchange-provider.factory';
import {
  CreateExchangeAccountDto,
  UpdateExchangeAccountDto,
  EnableExchangeAccountDto,
  DisableExchangeAccountDto,
  RevokeExchangeAccountDto,
  RotateCredentialsDto,
  ListExchangeAccountsDto,
} from './dto/exchange-account.dto';
import {
  CheckConnectivityDto,
  RefreshCapabilitiesDto,
  SyncBalancesDto,
  SyncPositionsDto,
  SyncOrdersDto,
  RouteExchangeDto,
  ListSymbolsDto,
} from './dto/exchange-connectivity.dto';
import { ExchangeEnvironment, ExchangeVenue } from './exchange.types';

/**
 * RBAC-protected exchange API for account connection, health, sync, routing.
 * Tenant-scoped, user-scoped for non-privileged.
 */

@Controller('exchanges')
@UseGuards(AuthGuard('jwt'))
export class ExchangesController {
  constructor(
    private readonly accountService: ExchangeAccountService,
    private readonly connectivityService: ExchangeConnectivityService,
    private readonly balanceSyncService: ExchangeBalanceSyncService,
    private readonly positionSyncService: ExchangePositionSyncService,
    private readonly orderSyncService: ExchangeOrderSyncService,
    private readonly healthService: ExchangeHealthService,
    private readonly rateLimitService: ExchangeRateLimitService,
    private readonly symbolService: ExchangeSymbolService,
    private readonly routingService: ExchangeRoutingService,
    private readonly registryService: ExchangeRegistryService,
    private readonly providerFactory: ExchangeProviderFactory,
  ) {}

  // ===== Registry =====

  @Get('registry/venues')
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_READ, Permission.TRADING_READ)
  async listVenues() {
    return this.registryService.getAllVenues().map((v) => ({
      venue: v.venue,
      displayName: v.displayName,
      supportedEnvironments: v.supportedEnvironments,
      supportedCapabilities: v.supportedCapabilities,
      supportedOrderTypes: v.supportedOrderTypes,
      apiVersion: v.apiVersion,
      restAvailable: v.restAvailable,
      websocketAvailable: v.websocketAvailable,
      symbolFormat: v.symbolFormat,
      rateLimitModel: v.rateLimitModel,
      authenticationModel: v.authenticationModel,
      requiresPassphrase: v.requiresPassphrase,
      isActive: v.isActive,
    }));
  }

  @Get('registry/providers')
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_READ, Permission.TRADING_READ)
  async listProviders() {
    return this.providerFactory.listAvailableVenues();
  }

  // ===== Accounts =====
  //
  // Connecting, listing, reading, disabling and revoking an exchange account
  // are owner operations: a follower or trader brings their own non-custodial
  // key, so these routes need only the account-level permission and every
  // lookup is scoped to the caller unless the caller holds tenant-wide
  // trading authority. Arming live trading, rotating a credential and the
  // tenant-wide connectivity/sync/routing surface below keep their
  // administrator permissions.

  /** Tenant-wide authority over every account in the tenant. */
  private static hasTenantWideAccountAuthority(user: AuthenticatedActor): boolean {
    const granted = user.permissions;
    return (
      user.isPlatformUser === true ||
      hasPermission(granted, Permission.TRADING_MANAGE) ||
      hasPermission(granted, Permission.PLATFORM_MANAGE)
    );
  }

  /** Resolves the account or throws 404 when it does not exist or is not the caller's. */
  private async requireAccessibleAccount(tenantId: string, id: string, user: AuthenticatedActor) {
    const ownerScope = ExchangesController.hasTenantWideAccountAuthority(user) ? null : user.userId;
    const account = await this.accountService.getAccount(tenantId, id, ownerScope);
    if (!account) throw new NotFoundException('Exchange account not found');
    return account;
  }

  @Post('accounts')
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_MANAGE)
  async connectAccount(
    @Body() dto: CreateExchangeAccountDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @Req() req: Pick<AppRequest, 'requestId'>,
  ) {
    return this.accountService.connectAccount({
      tenantId,
      userId: user.userId,
      venue: dto.venue,
      environment: dto.environment,
      label: dto.label,
      apiKey: dto.apiKey,
      apiSecret: dto.apiSecret,
      passphrase: dto.passphrase,
      credentialSource: dto.credentialSource || 'ENVELOPE_DB',
      credentialRef: dto.credentialRef || null,
      idempotencyKey: dto.idempotencyKey,
      ipAllowlist: dto.ipAllowlist,
      actorId: user.userId,
      requestId: req.requestId,
    });
  }

  @Get('accounts')
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_READ)
  async listAccounts(
    @Query() query: ListExchangeAccountsDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
  ) {
    const isPrivileged = ExchangesController.hasTenantWideAccountAuthority(user);
    const requesterUserId = user.userId;

    return this.accountService.listAccounts(
      tenantId,
      {
        userId: query.userId,
        venue: query.venue,
        environment: query.environment,
        status: query.status,
        page: query.page,
        limit: query.limit,
        search: query.search,
      },
      requesterUserId,
      isPrivileged,
    );
  }

  @Get('accounts/:id')
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_READ)
  async getAccount(
    @Param('id') id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
  ) {
    return this.requireAccessibleAccount(tenantId, id, user);
  }

  @Put('accounts/:id')
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_MANAGE, Permission.TRADING_WRITE)
  async updateAccount(
    @Param('id') id: string,
    @Body() dto: UpdateExchangeAccountDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
  ) {
    // For now, only label update is supported via repository - we implement via direct check
    const account = await this.accountService.getAccount(tenantId, id, user.userId);
    if (!account) throw new BadRequestException('Account not found');
    if (dto.label !== undefined)
      throw new ServiceUnavailableException(
        'A durable account-label update adapter is not configured; no account change was made',
      );
    throw new BadRequestException('No supported account update supplied');
  }

  @Post('accounts/:id/enable')
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_MANAGE, Permission.TRADING_MANAGE)
  async enableAccount(
    @Param('id') id: string,
    @Body() dto: EnableExchangeAccountDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @Req() req: Pick<AppRequest, 'requestId'>,
  ) {
    if (dto.liveTradingRequested) {
      return this.accountService.enableLiveTrading({
        tenantId,
        accountId: id,
        actorId: user.userId,
        requestId: req.requestId,
      });
    }
    await this.requireAccessibleAccount(tenantId, id, user);
    throw new ServiceUnavailableException(
      'Regular account enablement is not configured; returning an unchanged account would not prove enablement',
    );
  }

  @RequireStepUp('EXCHANGE_ACCOUNT_DISABLE')
  @Post('accounts/:id/disable')
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_MANAGE)
  async disableAccount(
    @Param('id') id: string,
    @Body() dto: DisableExchangeAccountDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @Req() req: Pick<AppRequest, 'requestId'>,
  ) {
    await this.requireAccessibleAccount(tenantId, id, user);
    const result = await this.accountService.disableAccount(
      tenantId,
      id,
      user.userId,
      dto.reason,
      req.requestId,
    );
    if (!result) throw new BadRequestException('Account not found');
    return result;
  }

  @RequireStepUp('EXCHANGE_KEY_REVOKE')
  @Post('accounts/:id/revoke')
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_MANAGE)
  async revokeAccount(
    @Param('id') id: string,
    @Body() dto: RevokeExchangeAccountDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @Req() req: Pick<AppRequest, 'requestId'>,
  ) {
    await this.requireAccessibleAccount(tenantId, id, user);
    const result = await this.accountService.revokeAccount(
      tenantId,
      id,
      user.userId,
      req.requestId,
    );
    if (!result) throw new BadRequestException('Account not found');
    return result;
  }

  @RequireStepUp('EXCHANGE_KEY_ROTATE')
  @Post('accounts/:id/rotate')
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_MANAGE, Permission.TRADING_WRITE)
  async rotateCredentials(
    @Param('id') id: string,
    @Body() dto: RotateCredentialsDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @Req() req: Pick<AppRequest, 'requestId'>,
  ) {
    const existing = await this.requireAccessibleAccount(tenantId, id, user);
    if (!existing) throw new BadRequestException('Account not found');

    const result = await this.accountService.rotateCredentials({
      tenantId,
      accountId: id,
      venue: existing.venue,
      environment: existing.environment,
      apiKey: dto.apiKey,
      apiSecret: dto.apiSecret,
      passphrase: dto.passphrase,
      credentialSource: dto.credentialSource || 'ENVELOPE_DB',
      credentialRef: dto.credentialRef || null,
      actorId: user.userId,
      requestId: req.requestId,
    });

    if (!result) throw new BadRequestException('Rotation failed');
    return result;
  }

  @Post('accounts/:id/refresh-capabilities')
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_READ, Permission.TRADING_READ)
  async refreshCapabilities(
    @Param('id') id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @Req() req: Pick<AppRequest, 'requestId'>,
  ) {
    const result = await this.accountService.refreshCapabilities(
      tenantId,
      id,
      user.userId,
      req.requestId,
    );
    if (!result) throw new BadRequestException('Account not found');
    return result;
  }

  // ===== Connectivity =====

  @Post('connectivity/check')
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_READ, Permission.TRADING_READ)
  async checkConnectivity(
    @Body() dto: CheckConnectivityDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
  ) {
    if (dto.accountId) {
      const account = await this.requireAccessibleAccount(tenantId, dto.accountId, user);
      if (!account) throw new BadRequestException('Account not found');
      return this.connectivityService.checkConnectivity({
        tenantId,
        accountId: account.accountId,
        venue: account.venue,
        environment: account.environment,
      });
    }

    if (!dto.venue || !dto.environment) {
      throw new BadRequestException('venue and environment required when accountId not provided');
    }

    // For registry check without account - return provider availability
    const providerAvailable = this.providerFactory.hasProvider(dto.venue);
    return {
      connected: false,
      degraded: false,
      state: providerAvailable ? 'DISCONNECTED' : 'FAILED',
      latencyMs: null,
      serverTimeMicros: null,
      clockDriftMs: null,
      capabilities: this.registryService.listCapabilities(dto.venue),
      failureCode: providerAvailable ? null : 'PROVIDER_UNAVAILABLE',
      failureReason: providerAvailable
        ? 'No accountId provided - provider availability check only'
        : 'Provider not registered',
      isSimulated: dto.environment !== ExchangeEnvironment.LIVE,
      environment: dto.environment,
    };
  }

  @Post('capabilities/discover')
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_READ, Permission.TRADING_READ)
  async discoverCapabilities(
    @Body() dto: RefreshCapabilitiesDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
  ) {
    if (!dto.accountId) throw new BadRequestException('accountId required');
    const account = await this.requireAccessibleAccount(tenantId, dto.accountId, user);
    if (!account) throw new BadRequestException('Account not found');

    return this.connectivityService.discoverCapabilities({
      tenantId,
      accountId: account.accountId,
      venue: account.venue,
      environment: account.environment,
    });
  }

  // ===== Health =====

  @Get('health')
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_READ, Permission.TRADING_READ)
  async listHealth(@TenantId() tenantId: string, @CurrentUser() user: AuthenticatedActor) {
    return this.healthService.listHealthByTenant(
      tenantId,
      ExchangesController.hasTenantWideAccountAuthority(user) ? undefined : user.userId,
    );
  }

  @Get('health/:accountId')
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_READ, Permission.TRADING_READ)
  async getHealth(
    @Param('accountId') accountId: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
  ) {
    await this.requireAccessibleAccount(tenantId, accountId, user);
    const health = await this.healthService.getHealth(tenantId, accountId);
    if (!health) throw new BadRequestException('Health not found');
    return health;
  }

  @Post('health/:accountId/check')
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_READ, Permission.TRADING_READ)
  async checkHealth(
    @Param('accountId') accountId: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
  ) {
    const account = await this.requireAccessibleAccount(tenantId, accountId, user);
    if (!account) throw new BadRequestException('Account not found');

    return this.healthService.checkHealth({
      tenantId,
      accountId: account.accountId,
      venue: account.venue,
      environment: account.environment,
    });
  }

  // ===== Sync =====

  @Post('sync/balances')
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_READ, Permission.TRADING_READ)
  async syncBalances(
    @Body() dto: SyncBalancesDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @Req() req: Pick<AppRequest, 'requestId'>,
  ) {
    const account = await this.requireAccessibleAccount(tenantId, dto.accountId, user);
    if (!account) throw new BadRequestException('Account not found');

    return this.balanceSyncService.syncBalances({
      tenantId,
      accountId: account.accountId,
      venue: account.venue,
      environment: account.environment,
      actorId: user.userId,
      requestId: req.requestId,
    });
  }

  @Post('sync/positions')
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_READ, Permission.TRADING_READ)
  async syncPositions(
    @Body() dto: SyncPositionsDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @Req() req: Pick<AppRequest, 'requestId'>,
  ) {
    const account = await this.requireAccessibleAccount(tenantId, dto.accountId, user);
    if (!account) throw new BadRequestException('Account not found');

    return this.positionSyncService.syncPositions({
      tenantId,
      accountId: account.accountId,
      venue: account.venue,
      environment: account.environment,
      actorId: user.userId,
      requestId: req.requestId,
    });
  }

  @Post('sync/orders')
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_READ, Permission.TRADING_READ)
  async syncOrders(
    @Body() dto: SyncOrdersDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @Req() req: Pick<AppRequest, 'requestId'>,
  ) {
    const account = await this.requireAccessibleAccount(tenantId, dto.accountId, user);
    if (!account) throw new BadRequestException('Account not found');

    const ordersResult = await this.orderSyncService.syncOrders({
      tenantId,
      accountId: account.accountId,
      venue: account.venue,
      environment: account.environment,
      symbol: dto.symbol,
      actorId: user.userId,
      requestId: req.requestId,
    });

    const fillsResult = await this.orderSyncService.syncFills({
      tenantId,
      accountId: account.accountId,
      venue: account.venue,
      environment: account.environment,
      symbol: dto.symbol,
      actorId: user.userId,
      requestId: req.requestId,
    });

    return { orders: ordersResult, fills: fillsResult };
  }

  // ===== Routing =====

  @Post('routing/decide')
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_READ, Permission.TRADING_READ)
  async route(
    @Body() dto: RouteExchangeDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @Req() req: Pick<AppRequest, 'requestId'>,
  ) {
    return this.routingService.route({
      tenantId,
      userId: user.userId,
      operation: dto.operation,
      symbol: dto.symbol,
      requiredCapability: dto.requiredCapability,
      environment: dto.environment,
      accountId: dto.accountId || null,
      complianceAllowed: dto.complianceAllowed,
      riskAllowed: dto.riskAllowed,
      actorId: user.userId,
      requestId: req.requestId,
    });
  }

  // ===== Symbols =====

  @Get('symbols')
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_READ, Permission.TRADING_READ)
  async listSymbols(@Query() query: ListSymbolsDto, @TenantId() tenantId: string) {
    return this.symbolService.listSymbols(tenantId, {
      baseAsset: query.baseAsset,
      quoteAsset: query.quoteAsset,
      isTradeable: query.isTradeable,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('symbols/:symbol')
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_READ, Permission.TRADING_READ)
  async getSymbol(@Param('symbol') symbol: string, @TenantId() tenantId: string) {
    const result = await this.symbolService.getSymbol(tenantId, symbol);
    if (!result) throw new BadRequestException('Symbol not found');
    return result;
  }

  @Post('symbols/:accountId/sync')
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_MANAGE, Permission.TRADING_WRITE)
  async syncSymbols(
    @Param('accountId') accountId: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
  ) {
    const account = await this.requireAccessibleAccount(tenantId, accountId, user);
    if (!account) throw new BadRequestException('Account not found');

    return this.symbolService.syncSymbols({
      tenantId,
      accountId: account.accountId,
      venue: account.venue,
      environment: account.environment,
    });
  }

  // ===== Rate Limits =====

  @Get('rate-limits/:accountId')
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_READ, Permission.TRADING_READ)
  async getRateLimits(
    @Param('accountId') accountId: string,
    @Query('venue') venue: string,
    @Query('environment') environment: string,
    @Query('endpointClass') endpointClass: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
  ) {
    const account = await this.requireAccessibleAccount(tenantId, accountId, user);
    if (!account) throw new BadRequestException('Account not found');

    const boundVenue = venue
      ? Object.values(ExchangeVenue).find((candidate) => candidate === venue)
      : account.venue;
    const boundEnvironment = environment
      ? Object.values(ExchangeEnvironment).find((candidate) => candidate === environment)
      : account.environment;
    if (
      !boundVenue ||
      !boundEnvironment ||
      boundVenue !== account.venue ||
      boundEnvironment !== account.environment
    )
      throw new BadRequestException('Rate-limit query must match the account venue/environment');
    return this.rateLimitService.getRateLimitState({
      tenantId,
      venue: boundVenue,
      environment: boundEnvironment,
      accountId: account.accountId,
      endpointClass: endpointClass || 'PRIVATE',
    });
  }
}
