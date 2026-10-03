import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import type { AuthenticatedActor } from '@wlct/shared-types';

import {
  SsoLoginService,
  type SsoCompleteResult,
  type SsoLogoutUrlResult,
  type SsoStartResult,
} from './sso-login.service';
import { SsoCallbackDto, SsoStartDto } from '../dto/sso-login.dto';
import { Public } from '../../../common/decorators/public.decorator';
import { CurrentTenant } from '../../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import {
  RequestMeta,
  type RequestMetadata,
} from '../../../common/decorators/request-context.decorator';
import { ApiStandardResponses } from '../../../common/decorators/api-standard-responses.decorator';
import type { AppRequest, TenantContext } from '../../../common/types/request.types';
import type { AuthRequestContext } from '../auth.service';

/**
 * Public single sign-on endpoints (Part 11).
 *
 *  POST /v1/auth/sso/start     - begin an OIDC or SAML login; returns the IdP
 *                                URL and the client binding secret.
 *  POST /v1/auth/sso/callback  - complete it with the redirect's state + code
 *                                (or error), the binding secret and device id;
 *                                returns a session or a 2FA challenge exactly
 *                                like POST /v1/auth/login.
 *  POST /v1/auth/sso/saml/acs  - SAML Assertion Consumer Service (the IdP's
 *                                HTTP-POST binding); 303-redirects the browser
 *                                to the configured completion URI.
 *  POST /v1/auth/sso/logout-url - (authenticated, self-service) the IdP
 *                                logout URL for the caller's current session:
 *                                OIDC RP-initiated logout, or a signed SAML
 *                                LogoutRequest (Single Logout); null for
 *                                password sessions and when the provider's
 *                                logout is not configured (with the reason).
 *  GET  /v1/auth/sso/saml/slo  - SAML SingleLogoutService (HTTP-Redirect
 *                                binding): the IdP's LogoutResponse to our
 *                                LogoutRequest, or an IdP-initiated
 *                                LogoutRequest; 303-redirects the browser.
 *
 * The tenant is always the one resolved from the request host. The public
 * routes are on the strict `auth` throttler bucket; refusals are generic.
 * Tokens are returned only in the response body of the server-to-server
 * callback (the web BFF stores them as HttpOnly cookies) and never appear
 * in a URL.
 */
@ApiTags('Authentication')
@Controller({ path: 'auth/sso', version: '1' })
@ApiStandardResponses()
export class SsoAuthController {
  constructor(private readonly ssoLogin: SsoLoginService) {}

  @Post('logout-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "IdP logout URL for the caller's current SSO session (call before POST /v1/auth/logout)" })
  @ApiOkResponse({ description: 'logoutUrl (null when only a local logout applies), providerType and reason.' })
  async logoutUrl(
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<SsoLogoutUrlResult> {
    return this.ssoLogin.logoutUrl(actor.tenantId, actor.userId, actor.sessionId, meta.ipHash);
  }

  @Post('start')
  @Public()
  @Throttle({ auth: { limit: 20, ttl: 300_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start a single sign-on login for the resolved tenant' })
  @ApiBody({ type: SsoStartDto })
  @ApiOkResponse({ description: 'IdP authorization URL and the client binding secret.' })
  async start(
    @Body() dto: SsoStartDto,
    @CurrentTenant() tenant: TenantContext,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<SsoStartResult> {
    return this.ssoLogin.start(
      tenant,
      { providerType: dto.providerType ?? null, deviceId: dto.deviceId, returnTo: dto.returnTo ?? null },
      this.context(meta),
    );
  }

  @Post('callback')
  @Public()
  @Throttle({ auth: { limit: 20, ttl: 300_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete a single sign-on login' })
  @ApiBody({ type: SsoCallbackDto })
  @ApiOkResponse({
    description: 'A session or a two-factor challenge, plus the validated return path.',
  })
  async callback(
    @Body() dto: SsoCallbackDto,
    @CurrentTenant() tenant: TenantContext,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<SsoCompleteResult> {
    return this.ssoLogin.complete(
      tenant,
      {
        state: dto.state,
        code: dto.code ?? null,
        error: dto.error ?? null,
        bindingToken: dto.bindingToken,
        deviceId: dto.deviceId,
        deviceName: dto.deviceName ?? null,
        platform: dto.platform ?? null,
        appVersion: dto.appVersion ?? null,
      },
      this.context(meta),
    );
  }

  /**
   * The IdP posts an application/x-www-form-urlencoded form with SAMLResponse
   * and RelayState. Only those two fields are read, straight from the parsed
   * body (a DTO would reject the IdP's extra fields); the SAML provider
   * validates them.
   */
  @Post('saml/acs')
  @Public()
  @Throttle({ auth: { limit: 20, ttl: 300_000 } })
  @ApiOperation({ summary: 'SAML Assertion Consumer Service (HTTP-POST binding)' })
  async samlAcs(
    @Req() request: AppRequest,
    @Res() response: Response,
    @CurrentTenant() tenant: TenantContext,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<void> {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const outcome = await this.ssoLogin.consumeSamlResponse(
      tenant,
      { SAMLResponse: body.SAMLResponse, RelayState: body.RelayState },
      this.context(meta),
    );
    response.setHeader('Cache-Control', 'no-store');
    if (!outcome.redirectTo) {
      response.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Single sign-on could not be completed.' },
      });
      return;
    }
    response.redirect(HttpStatus.SEE_OTHER, outcome.redirectTo);
  }

  /**
   * SAML Single Logout (HTTP-Redirect binding only). The query string is
   * passed on exactly as received: the redirect-binding signature covers its
   * URL-encoded bytes, so it must not be re-serialised. A message that is
   * not a verifiable logout message for this tenant gets 400.
   */
  @Get('saml/slo')
  @Public()
  @Throttle({ auth: { limit: 20, ttl: 300_000 } })
  @ApiOperation({ summary: 'SAML SingleLogoutService (HTTP-Redirect binding)' })
  async samlSlo(
    @Req() request: AppRequest,
    @Res() response: Response,
    @CurrentTenant() tenant: TenantContext,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<void> {
    const url = String(request.originalUrl ?? request.url ?? '');
    const queryStart = url.indexOf('?');
    const rawQuery = queryStart >= 0 ? url.slice(queryStart + 1) : '';
    const outcome = await this.ssoLogin.consumeSamlLogout(tenant, rawQuery, this.context(meta));
    response.setHeader('Cache-Control', 'no-store');
    if (!outcome.redirectTo) {
      response.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'The logout message could not be processed.' },
      });
      return;
    }
    response.redirect(HttpStatus.SEE_OTHER, outcome.redirectTo);
  }

  private context(meta: RequestMetadata): AuthRequestContext {
    return {
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
      locale: meta.locale,
    };
  }
}
