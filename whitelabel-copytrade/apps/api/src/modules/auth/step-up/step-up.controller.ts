// # Exposes authenticated, permission-decorated step-up verification and action-specific status endpoints.
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  Permission,
  STEP_UP_ACTIONS,
  type AuthenticatedActor,
  type StepUpAction,
} from '@wlct/shared-types';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import {
  RequestMeta,
  type RequestMetadata,
} from '../../../common/decorators/request-context.decorator';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '@wlct/shared-types';
import { VerifyStepUpDto } from './dto/verify-step-up.dto';
import { StepUpService } from './step-up.service';

@Controller({ path: 'auth/step-up', version: '1' })
@RequirePermissions(Permission.USER_READ)
export class StepUpController {
  constructor(private readonly stepUp: StepUpService) {}

  @Get('status')
  async status(@CurrentUser() actor: AuthenticatedActor, @Query('action') actionRaw?: string) {
    const action = actionRaw === undefined ? null : this.parseAction(actionRaw);
    return this.stepUp.status(actor, action);
  }

  @Post('verify')
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  async verify(
    @Body() dto: VerifyStepUpDto,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ) {
    return this.stepUp.verify(actor, dto, {
      ipHash: meta.ipHash,
      requestId: meta.requestId,
      userAgent: meta.userAgent,
    });
  }

  private parseAction(value: string): StepUpAction {
    if ((STEP_UP_ACTIONS as readonly string[]).includes(value)) return value as StepUpAction;
    throw new AppException({
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Unknown step-up action.',
    });
  }
}
