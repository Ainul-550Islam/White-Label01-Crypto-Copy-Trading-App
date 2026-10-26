// # Serves the step-up challenge: verify a credential for one named action and return a single-use proof id, plus the status of any live proof.
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  STEP_UP_ACTIONS,
  type AuthenticatedActor,
  type StepUpAction,
  type StepUpChallengeInput,
  type StepUpMethod,
  type StepUpProofIssued,
  type StepUpStatus,
} from '@wlct/shared-types';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestMeta, type RequestMetadata } from '../../common/decorators/request-context.decorator';
import { AllowAnyAuthenticated } from '../../common/decorators/permissions.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';
import { StepUpAuthService } from './step-up-auth.service';

/** Body of the challenge request; the shared interface is the client contract. */
export class StepUpChallengeDto implements StepUpChallengeInput {
  @IsIn(STEP_UP_ACTIONS as unknown as string[], { message: 'action must be one of the supported sensitive actions' })
  action!: StepUpAction;

  @IsIn(['TOTP', 'PASSWORD', 'RECOVERY_CODE'], { message: 'method must be TOTP, PASSWORD or RECOVERY_CODE' })
  method!: StepUpMethod;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  recoveryCode?: string;
}

/**
 * `POST /v1/auth/step-up/verify` - "prove it, for this action".
 *
 * Self-service by design: the caller can only mint a proof for their own
 * (tenant, user, session), because the principal comes from the JWT and no
 * parameter names a user. That is why the route is `@AllowAnyAuthenticated()`
 * and not permission-decorated - a proof is not an authorisation, it is the
 * second factor on top of one.
 *
 * Throttled to five attempts a minute per user: brute-forcing a six-digit TOTP
 * at that rate outlives the code, and the account-lockout counters underneath
 * catch a slower campaign.
 */
@ApiTags('Authentication')
@Controller({ path: 'auth/step-up', version: '1' })
@ApiStandardResponses()
export class StepUpAuthController {
  constructor(private readonly stepUpAuthService: StepUpAuthService) {}

  @Get('status')
  @AllowAnyAuthenticated()
  @ApiOperation({ summary: 'Whether a live step-up proof exists for this action' })
  @ApiOkResponse({ description: 'Freshness of the caller’s own proof for the named action.' })
  async status(
    @CurrentUser() actor: AuthenticatedActor,
    @Query('action') action?: string,
  ): Promise<StepUpStatus> {
    const requested = typeof action === 'string' && (STEP_UP_ACTIONS as readonly string[]).includes(action)
      ? (action as StepUpAction)
      : null;
    return this.stepUpAuthService.status(actor, requested);
  }

  @Get('actions')
  @AllowAnyAuthenticated()
  @ApiOperation({ summary: 'Every action a step-up proof can be issued for' })
  actions(): { actions: readonly string[] } {
    return { actions: STEP_UP_ACTIONS };
  }

  /**
   * The canonical issue route: `POST /v1/auth/step-up`.
   *
   * `POST /v1/auth/step-up/verify` remains as an alias so existing clients keep
   * working; both paths run the same handler, because two implementations of "issue
   * a proof" would eventually disagree about what a proof is bound to.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @AllowAnyAuthenticated()
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify a credential for one sensitive action and receive a single-use proof' })
  @ApiOkResponse({ description: 'A single-use, action-bound proof.' })
  async challengeAtRoot(
    @Body() dto: StepUpChallengeDto,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<StepUpProofIssued> {
    return this.challenge(dto, actor, meta);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @AllowAnyAuthenticated()
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Verify a credential for one sensitive action',
    description:
      'Returns a single-use proof id bound to (tenant, user, session, action). It is consumed by the first request that uses it, and a proof for one action is refused for any other.',
  })
  @ApiOkResponse({ description: 'A single-use, action-bound proof.' })
  async challenge(
    @Body() dto: StepUpChallengeDto,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<StepUpProofIssued> {
    return this.stepUpAuthService.issue(
      actor,
      {
        action: dto.action,
        method: dto.method,
        code: dto.code,
        password: dto.password,
        recoveryCode: dto.recoveryCode,
      },
      {
        ipHash: meta.ipHash ?? '',
        requestId: meta.requestId ?? '',
        userAgent: meta.userAgent ?? null,
      },
    );
  }
}
