import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditAction, Permission, type PaginatedResult, type UserDto } from '@wlct/shared-types';
import type { AuthenticatedActor } from '@wlct/shared-types';

import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { AdminUpdateUserDto, AssignRolesDto, SuspendUserDto, UpdateUserDto } from './dto/update-user.dto';
import { ListUsersDto } from './dto/list-users.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequestMeta, type RequestMetadata } from '../../common/decorators/request-context.decorator';
import { Audited } from '../../common/decorators/audit.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';

@ApiTags('Users')
@Controller({ path: 'users', version: '1' })
@ApiStandardResponses()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fetch the authenticated user profile' })
  @ApiOkResponse({ description: 'The current user.' })
  async me(@CurrentUser() actor: AuthenticatedActor): Promise<UserDto> {
    return this.usersService.findByIdForSession(actor.userId, actor.tenantId);
  }

  @Patch('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update the authenticated user profile' })
  @ApiOkResponse({ description: 'The updated profile.' })
  async updateMe(
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<UserDto> {
    return this.usersService.updateProfile(actor.tenantId, actor.userId, dto, {
      actorId: actor.userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.USER_READ)
  @ApiOperation({ summary: 'List users in the current organisation' })
  @ApiOkResponse({ description: 'Paginated users.' })
  async list(
    @Query() query: ListUsersDto,
    @TenantId() tenantId: string,
  ): Promise<PaginatedResult<UserDto>> {
    return this.usersService.list(tenantId, query);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.USER_READ)
  @ApiOperation({ summary: 'Fetch a single user' })
  @ApiOkResponse({ description: 'The requested user.' })
  async findOne(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
  ): Promise<UserDto> {
    return this.usersService.findById(tenantId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permission.USER_CREATE)
  @Audited(AuditAction.USER_CREATED, 'User')
  @ApiOperation({ summary: 'Create a user inside the current organisation' })
  @ApiCreatedResponse({ description: 'The created user.' })
  async create(
    @Body() dto: CreateUserDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<UserDto> {
    return this.usersService.create(tenantId, dto, {
      actorId: actor.userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.USER_UPDATE)
  @ApiOperation({ summary: 'Update a user as an administrator' })
  @ApiOkResponse({ description: 'The updated user.' })
  async update(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: AdminUpdateUserDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<UserDto> {
    return this.usersService.adminUpdate(tenantId, id, dto, {
      actorId: actor.userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.USER_SUSPEND)
  @ApiOperation({
    summary: 'Suspend a user',
    description: 'Immediately revokes every session and refresh token for the account.',
  })
  @ApiOkResponse({ description: 'The suspended user.' })
  async suspend(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: SuspendUserDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<UserDto> {
    return this.usersService.suspend(tenantId, id, dto.reason, {
      actorId: actor.userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });
  }

  @Post(':id/reinstate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.USER_SUSPEND)
  @ApiOperation({ summary: 'Reinstate a suspended user' })
  @ApiOkResponse({ description: 'The reinstated user.' })
  async reinstate(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<UserDto> {
    return this.usersService.reinstate(tenantId, id, {
      actorId: actor.userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });
  }

  @Post(':id/roles')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.USER_ASSIGN_ROLE)
  @ApiOperation({ summary: 'Replace the role assignments of a user' })
  @ApiOkResponse({ description: 'The user with updated roles.' })
  async assignRoles(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: AssignRolesDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<UserDto> {
    return this.usersService.assignRoles(tenantId, id, dto.roleIds, {
      actorId: actor.userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.USER_DELETE)
  @ApiOperation({ summary: 'Soft delete a user' })
  @ApiOkResponse({ description: 'Deletion acknowledgement.' })
  async remove(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<{ id: string; deleted: true }> {
    return this.usersService.softDelete(tenantId, id, {
      actorId: actor.userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });
  }
}
