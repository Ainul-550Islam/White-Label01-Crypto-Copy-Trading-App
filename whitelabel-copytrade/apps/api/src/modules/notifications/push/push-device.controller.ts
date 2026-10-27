import { Body, Controller, Delete, HttpCode, Post, Req } from '@nestjs/common';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import type { AuthenticatedActor } from '@wlct/shared-types';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AllowAnyAuthenticated } from '../../../common/decorators/permissions.decorator';
import { requireMutationKey } from '../../developer-platform/developer-mutation-intent';
import { PushDeviceService } from './push-device.service';
class PushDeviceDto {
  @IsIn(['FCM', 'APNS']) platform!: 'FCM' | 'APNS';
  @IsString() @MinLength(20) @MaxLength(4096) token!: string;
}
@Controller({ path: 'notifications/push-devices', version: '1' })
@AllowAnyAuthenticated()
export class PushDeviceController {
  constructor(private readonly devices: PushDeviceService) {}
  @Post() @HttpCode(200)
  register(@CurrentUser() actor: AuthenticatedActor, @Body() dto: PushDeviceDto, @Req() request: Request) {
    return this.devices.register(actor, dto.platform, dto.token, requireMutationKey(request));
  }
  @Delete() @HttpCode(200)
  unregister(@CurrentUser() actor: AuthenticatedActor, @Req() request: Request) {
    return this.devices.unregister(actor, requireMutationKey(request));
  }
}
