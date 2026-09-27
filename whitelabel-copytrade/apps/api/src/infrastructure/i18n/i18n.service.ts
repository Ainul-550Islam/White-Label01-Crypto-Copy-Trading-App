import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { AppConfigService } from '../../config/app-config.service';
import en from './locales/en.json';
import es from './locales/es.json';
import ar from './locales/ar.json';
import bn from './locales/bn.json';
import tr from './locales/tr.json';

type MessageCatalog = Record<string, string>;

/**
 * Minimal, dependency-free translation service.
 *
 * Catalogues are flat key/value JSON so they can be handed to translators and
 * reused verbatim by the Flutter and Next.js clients. Missing keys fall back to
 * the default locale and are logged once so gaps surface during QA rather than
 * in front of a customer.
 */
@Injectable()
export class I18nService implements OnModuleInit {
  private readonly catalogues: Record<string, MessageCatalog> = { en, es, ar, bn, tr };
  private readonly reportedMissing = new Set<string>();
  private fallbackLocale = 'en';

  constructor(
    private readonly config: AppConfigService,
    @InjectPinoLogger(I18nService.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.fallbackLocale = this.config.defaultLocale;
    this.logger.info(
      { event: 'i18n.loaded', locales: Object.keys(this.catalogues) },
      'Translation catalogues loaded',
    );
  }

  get supportedLocales(): string[] {
    return Object.keys(this.catalogues);
  }

  /**
   * Resolves a message key for a locale and interpolates `{placeholders}`.
   * Interpolated values are inserted verbatim; callers must not pass untrusted
   * HTML into templates that are rendered as markup.
   */
  translate(key: string, locale: string, params: Record<string, string | number> = {}): string {
    const normalised = this.normaliseLocale(locale);
    const catalogue = this.catalogues[normalised] ?? this.catalogues[this.fallbackLocale];
    let template = catalogue?.[key];

    if (!template) {
      template = this.catalogues[this.fallbackLocale]?.[key];
      const missingKey = `${normalised}:${key}`;
      if (!this.reportedMissing.has(missingKey)) {
        this.reportedMissing.add(missingKey);
        this.logger.warn({ event: 'i18n.missing_key', key, locale: normalised }, 'Missing translation');
      }
    }

    if (!template) {
      return key;
    }

    return template.replace(/\{(\w+)\}/g, (match, token: string) =>
      Object.prototype.hasOwnProperty.call(params, token) ? String(params[token]) : match,
    );
  }

  isRtl(locale: string): boolean {
    return ['ar', 'he', 'fa', 'ur'].includes(this.normaliseLocale(locale));
  }

  private normaliseLocale(locale: string): string {
    const base = locale.toLowerCase().split('-')[0];
    return this.catalogues[base] ? base : this.fallbackLocale;
  }
}
