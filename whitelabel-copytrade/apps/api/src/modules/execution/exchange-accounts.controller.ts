import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, hasPermission } from '@wlct/shared-types';
import type { AuthenticatedActor, PaginatedResult } from '@wlct/shared-types';

import { ExchangeAccountsService } from './exchange-accounts.service';
import { ExecutionCommandsService } from './execution-commands.service';
import {
  ListBalancesDto,
  ListExchangeAccountsDto,
  SetEnabledDto,
  SetLiveTradingDto,
  SetPrivateStreamDto,
} from './dto/execution.dto';
import type {
  AccountConnectivityView,
  BalanceView,
  CommandAcceptedView,
  ExchangeAccountView,
  StreamSessionView,
} from './execution.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import { ValidationException } from '../../common/errors/app.exception';
import { RequestMeta } from '../../common/decorators/request-context.decorator';
import type { RequestMetadata } from '../../common/decorators/request-context.decorator';

/**
 * Exchange account surface: state, connectivity, balances, and the two
 * administrative toggles that decide whether the account can trade at all.
 *
 * Nothing on this controller returns key material. The service layer never
 * loads the ciphertext columns and the mapper cannot emit them, so this holds
 * even if a future handler is written carelessly.
 */
@ApiTags('Execution / Exchange Accounts')
@Controller({ path: 'execution/accounts', version: '1' })
@ApiStandardResponses()
export class ExchangeAccountsController {
  constructor(
    private readonly accounts: ExchangeAccountsService,
    private readonly commands: ExecutionCommandsService,
  ) {}

  /**
   * Callers holding only the base read permission see their own accounts.
   * Anyone who can administer accounts sees the whole tenant.
   *
   * Computed from the actor's permissions rather than from their role, so a
   * custom role composed by a tenant admin behaves predictably.
   */
  private scopeFor(actor: AuthenticatedActor): string | undefined {
    const isOperator =
      hasPermission(actor.permissions, Permission.EXCHANGE_ACCOUNT_ENABLE_LIVE) ||
      hasPermission(actor.permissions, Permission.EXECUTION_READ);
    return isOperator ? undefined : actor.userId;
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_READ)
  @ApiOperation({ summary: 'List exchange accounts' })
  @ApiOkResponse({ description: 'Paginated exchange accounts, without credential material.' })
  async list(
    @Query() query: ListExchangeAccountsDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
  ): Promise<PaginatedResult<ExchangeAccountView>> {
    return this.accounts.list({ ...query, tenantId, restrictToUserId: this.scopeFor(actor) });
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_READ)
  @ApiOperation({ summary: 'Fetch one exchange account' })
  @ApiOkResponse({ description: 'The account, with a credential summary but no secrets.' })
  async get(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
  ): Promise<ExchangeAccountView> {
    return this.accounts.get(tenantId, id, this.scopeFor(actor));
  }

  @Get(':id/connectivity')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_READ)
  @ApiOperation({ summary: 'Connectivity and health roll-up for one account' })
  @ApiOkResponse({
    description:
      'Credential verification state, private stream session, last reconciliation run, ' +
      'open incident counts and the number of orders whose state is not trusted.',
  })
  async connectivity(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
  ): Promise<AccountConnectivityView> {
    return this.accounts.connectivity(tenantId, id, this.scopeFor(actor));
  }

  @Get(':id/balances')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.BALANCE_READ)
  @ApiOperation({ summary: 'Latest venue balances for one account' })
  @ApiOkResponse({
    description:
      'Normalised free/locked/total per asset, as last observed. Simulated balances are ' +
      'flagged and never silently mixed with real ones.',
  })
  async balances(
    @Param('id', ParseUuidPipe) id: string,
    @Query() query: ListBalancesDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
  ): Promise<BalanceView[]> {
    return this.accounts.balances(tenantId, id, {
      includeZero: query.includeZero,
      restrictToUserId: this.scopeFor(actor),
    });
  }

  @Get(':id/stream-sessions')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PRIVATE_STREAM_READ)
  @ApiOperation({ summary: 'Recent private user-data stream sessions' })
  @ApiOkResponse({
    description: 'Up to 20 sessions. Listen keys appear masked; the real key is never stored.',
  })
  async streamSessions(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
  ): Promise<StreamSessionView[]> {
    return this.accounts.streamSessions(tenantId, id, this.scopeFor(actor));
  }

  // ---------------------------------------------------------------------------
  // Commands - dispatched to the trading worker, which holds the credentials
  // ---------------------------------------------------------------------------

  @Post(':id/verify')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_VERIFY)
  @ApiOperation({ summary: 'Queue a credential check against the venue' })
  @ApiOkResponse({ description: 'The verification job was queued.' })
  async verify(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
  ): Promise<CommandAcceptedView> {
    // Resolved through the tenant-scoped service first: queueing work for an
    // account id that belongs to someone else must not be possible, and the
    // 404 has to come from the same code path as every other lookup.
    await this.accounts.get(tenantId, id, this.scopeFor(actor));
    return this.commands.verifyCredentials(tenantId, id, actor.userId);
  }

  @Post(':id/balances/refresh')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(Permission.BALANCE_REFRESH)
  @ApiOperation({ summary: 'Queue a balance refresh against the venue' })
  @ApiOkResponse({ description: 'The refresh job was queued.' })
  async refreshBalances(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
  ): Promise<CommandAcceptedView> {
    await this.accounts.get(tenantId, id, this.scopeFor(actor));
    return this.commands.refreshBalances(tenantId, id, actor.userId);
  }

  @Post(':id/stream/resync')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(Permission.PRIVATE_STREAM_MANAGE)
  @ApiOperation({ summary: 'Force a private stream reconnect and follow-up reconciliation' })
  @ApiOkResponse({ description: 'The resync job was queued.' })
  async resyncStream(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
  ): Promise<CommandAcceptedView> {
    await this.accounts.get(tenantId, id);
    return this.commands.resyncPrivateStream(tenantId, id, actor.userId);
  }

  // ---------------------------------------------------------------------------
  // Administrative toggles
  // ---------------------------------------------------------------------------

  @Post(':id/enabled')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_MANAGE)
  @ApiOperation({ summary: 'Enable or disable an exchange account for trading' })
  @ApiOkResponse({ description: 'The updated account.' })
  async setEnabled(
    @Param('id', ParseUuidPipe) id: string,
    @Body() body: SetEnabledDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<ExchangeAccountView> {
    return this.accounts.setEnabled(
      tenantId,
      id,
      body.enabled,
      { userId: actor.userId, requestId: meta.requestId },
      body.reason,
    );
  }

  @Post(':id/live-trading')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.EXCHANGE_ACCOUNT_ENABLE_LIVE)
  @ApiOperation({ summary: 'Arm or disarm live trading on one exchange account' })
  @ApiOkResponse({ description: 'The updated account.' })
  async setLiveTrading(
    @Param('id', ParseUuidPipe) id: string,
    @Body() body: SetLiveTradingDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<ExchangeAccountView> {
    // Checked here rather than by a DTO rule because it is conditional: the
    // phrase is required to arm and meaningless to disarm. Disarming must never
    // be harder than arming.
    if (body.enabled && body.confirmation !== 'ENABLE LIVE TRADING') {
      throw new ValidationException([
        {
          field: 'confirmation',
          constraint: 'confirmationPhrase',
          message:
            'Arming live trading requires the confirmation phrase "ENABLE LIVE TRADING". ' +
            'This is the only control in the platform that lets real orders reach a venue.',
        },
      ]);
    }

    return this.accounts.setLiveTrading(
      tenantId,
      id,
      body.enabled,
      { userId: actor.userId, requestId: meta.requestId },
      body.reason,
    );
  }

  @Post(':id/private-stream')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PRIVATE_STREAM_MANAGE)
  @ApiOperation({ summary: 'Enable or disable the private user-data stream for an account' })
  @ApiOkResponse({ description: 'The updated account.' })
  async setPrivateStream(
    @Param('id', ParseUuidPipe) id: string,
    @Body() body: SetPrivateStreamDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<ExchangeAccountView> {
    return this.accounts.setPrivateStream(
      tenantId,
      id,
      body.enabled,
      { userId: actor.userId, requestId: meta.requestId },
      body.reason,
    );
  }
}
