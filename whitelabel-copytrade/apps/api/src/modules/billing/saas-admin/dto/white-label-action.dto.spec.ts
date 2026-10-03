import type { ArgumentMetadata } from '@nestjs/common';

import { GlobalValidationPipe } from '../../../../common/pipes/global-validation.pipe';

import { WhiteLabelActionRequestDto } from './feature-access.dto';

/**
 * The white-label request/disable endpoints were unusable: the DTO declared
 * `configuration` and `reason` with Swagger decorators only, and the global
 * pipe (whitelist + forbidNonWhitelisted) rejects any property without a
 * class-validator decorator - so every request that sent a body got a 422.
 */
describe('WhiteLabelActionRequestDto through the global validation pipe', () => {
  const pipe = new GlobalValidationPipe();
  const meta: ArgumentMetadata = { type: 'body', metatype: WhiteLabelActionRequestDto, data: '' };

  it('accepts a request with a configuration object', async () => {
    const out = (await pipe.transform({ configuration: { requestedAt: '2026-09-30T00:00:00.000Z' } }, meta)) as WhiteLabelActionRequestDto;
    expect(out).toBeInstanceOf(WhiteLabelActionRequestDto);
    expect(out.configuration).toEqual({ requestedAt: '2026-09-30T00:00:00.000Z' });
  });

  it('accepts a disable reason and an empty body', async () => {
    await expect(pipe.transform({ reason: 'Admin disabled' }, meta)).resolves.toMatchObject({ reason: 'Admin disabled' });
    await expect(pipe.transform({}, meta)).resolves.toBeInstanceOf(WhiteLabelActionRequestDto);
  });

  it('still rejects unknown properties and wrong types', async () => {
    await expect(pipe.transform({ tenantId: 'other-tenant' }, meta)).rejects.toBeDefined();
    await expect(pipe.transform({ configuration: 'not-an-object' }, meta)).rejects.toBeDefined();
    await expect(pipe.transform({ reason: 'x'.repeat(501) }, meta)).rejects.toBeDefined();
  });
});
