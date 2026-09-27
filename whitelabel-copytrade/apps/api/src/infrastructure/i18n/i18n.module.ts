import { Global, Module } from '@nestjs/common';

import { I18nService } from './i18n.service';

/** Server-side message localisation for API responses, emails and push copy. */
@Global()
@Module({
  providers: [I18nService],
  exports: [I18nService],
})
export class I18nModule {}
