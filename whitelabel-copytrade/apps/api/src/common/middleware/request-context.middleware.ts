import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { HEADER_CORRELATION_ID, HEADER_REQUEST_ID } from '@wlct/config';

import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { AppConfigService } from '../../config/app-config.service';
import type { AppRequest } from '../types/request.types';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Establishes per-request context before anything else runs:
 *   - a correlation id (accepted from an upstream proxy only if it is a UUID,
 *     so a client cannot inject arbitrary text into log fields) and the same
 *     id propagated to Python services and queue payloads (Part 9);
 *   - a keyed hash of the client IP, used everywhere instead of the raw address
 *     to limit personal data retention;
 *   - the negotiated locale for i18n.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    private readonly crypto: CryptoService,
    private readonly config: AppConfigService,
  ) {}

  use(req: AppRequest, res: Response, next: NextFunction): void {
    const incomingId = req.headers[HEADER_REQUEST_ID];
    const candidate = Array.isArray(incomingId) ? incomingId[0] : incomingId;
    const requestId = candidate && UUID_PATTERN.test(candidate) ? candidate : randomUUID();

    req.requestId = requestId;
    req.id = requestId;

    const incomingCorrelation = req.headers[HEADER_CORRELATION_ID];
    const correlationCandidate = Array.isArray(incomingCorrelation)
      ? incomingCorrelation[0]
      : incomingCorrelation;
    req.correlationId =
      correlationCandidate && UUID_PATTERN.test(correlationCandidate) ? correlationCandidate : requestId;
    res.setHeader(HEADER_CORRELATION_ID, req.correlationId);
    req.startTime = Date.now();
    req.ipHash = this.crypto.hashIp(req.ip ?? 'unknown');
    req.locale = this.negotiateLocale(req.headers['accept-language']);

    res.setHeader(HEADER_REQUEST_ID, requestId);

    next();
  }

  private negotiateLocale(header: string | string[] | undefined): string {
    const supported = this.config.supportedLocales;
    const fallback = this.config.defaultLocale;
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw) {
      return fallback;
    }

    const ranked = raw
      .split(',')
      .map((part) => {
        const [tag, qualityPart] = part.trim().split(';q=');
        const quality = qualityPart ? Number.parseFloat(qualityPart) : 1;
        return { tag: tag.trim().toLowerCase(), quality: Number.isNaN(quality) ? 0 : quality };
      })
      .sort((a, b) => b.quality - a.quality);

    for (const { tag } of ranked) {
      const base = tag.split('-')[0];
      if (supported.includes(tag)) {
        return tag;
      }
      if (supported.includes(base)) {
        return base;
      }
    }

    return fallback;
  }
}
