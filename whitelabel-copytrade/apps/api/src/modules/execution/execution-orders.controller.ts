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
import { Permission } from '@wlct/shared-types';
import type { AuthenticatedActor, PaginatedResult } from '@wlct/shared-types';

import { ExecutionOrdersService } from './execution-orders.service';
import {
  CancelOrderDto,
  ListFillsDto,
  ListOrdersDto,
  ListPositionsDto,
} from './dto/execution.dto';
import type {
  FillView,
  OrderEventView,
  OrderView,
  PositionView,
} from './execution.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import {
  RequestMeta,
  type RequestMetadata,
} from '../../common/decorators/request-context.decorator';

/**
 * Order, event, fill and position reads, plus cancellation.
 *
 * There is deliberately no order-placement endpoint. Placing an order requires
 * validation, ten pre-submit safety gates, a mandatory risk evaluation, a
 * distributed execution lock and a signed request - all of which live in the
 * trading worker. Exposing an HTTP route that skipped any of them would be a
 * risk bypass with a REST interface, so the route does not exist.
 */
@ApiTags('Execution / Orders')
@Controller({ path: 'execution', version: '1' })
@ApiStandardResponses()
export class ExecutionOrdersController {
  constructor(private readonly orders: ExecutionOrdersService) {}

  @Get('orders')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.ORDER_READ)
  @ApiOperation({ summary: 'List orders' })
  @ApiOkResponse({
    description:
      'Paginated orders. `reconciliationState` reports how far the local record can be ' +
      'trusted, independently of `status`, which is what the venue believes.',
  })
  async listOrders(
    @Query() query: ListOrdersDto,
    @TenantId() tenantId: string,
  ): Promise<PaginatedResult<OrderView>> {
    return this.orders.listOrders({ ...query, tenantId });
  }

  @Get('orders/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.ORDER_READ)
  @ApiOperation({ summary: 'Fetch one order' })
  @ApiOkResponse({ description: 'The order.' })
  async getOrder(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
  ): Promise<OrderView> {
    return this.orders.getOrder(tenantId, id);
  }

  @Get('orders/:id/events')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.ORDER_EVENT_READ)
  @ApiOperation({ summary: 'Immutable event trail for one order' })
  @ApiOkResponse({
    description:
      'Every recorded state transition in venue-timestamp order, including transitions that ' +
      'were refused as illegal.',
  })
  async listOrderEvents(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
  ): Promise<OrderEventView[]> {
    return this.orders.listOrderEvents(tenantId, id);
  }

  @Get('orders/:id/fills')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.FILL_READ)
  @ApiOperation({ summary: 'Fills for one order' })
  @ApiOkResponse({
    description: 'Normalised fills. Simulated fills are always flagged as such.',
  })
  async listOrderFills(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
  ): Promise<FillView[]> {
    return this.orders.listOrderFills(tenantId, id);
  }

  @Post('orders/:id/cancel')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(Permission.EXECUTION_CANCEL)
  @ApiOperation({ summary: 'Request cancellation of a working order' })
  @ApiOkResponse({
    description:
      'The order as it currently stands. It is NOT marked cancelled: only the venue can ' +
      'cancel an order, and it may fill before the cancel arrives.',
  })
  async cancel(
    @Param('id', ParseUuidPipe) id: string,
    @Body() body: CancelOrderDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<OrderView> {
    return this.orders.requestCancel(
      tenantId,
      id,
      { userId: actor.userId, requestId: meta.requestId },
      body.reason,
    );
  }

  @Get('fills')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.FILL_READ)
  @ApiOperation({ summary: 'List fills across orders' })
  @ApiOkResponse({ description: 'Paginated fills, newest first by default.' })
  async listFills(
    @Query() query: ListFillsDto,
    @TenantId() tenantId: string,
  ): Promise<PaginatedResult<FillView>> {
    return this.orders.listFills({ ...query, tenantId });
  }

  @Get('positions')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.POSITION_READ)
  @ApiOperation({ summary: 'Current positions' })
  @ApiOkResponse({
    description:
      'Open positions. Unrealised PnL is returned only alongside the mark price it was ' +
      'computed against; a position built from any simulated fill is flagged permanently.',
  })
  async listPositions(
    @Query() query: ListPositionsDto,
    @TenantId() tenantId: string,
  ): Promise<PositionView[]> {
    return this.orders.listPositions({ ...query, tenantId });
  }
}
