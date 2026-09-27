/**
 * Provider Request Service
 * Shared outbound provider request layer with correlation IDs, timeout handling,
 * safe retry classification, request signing hooks, rate-limit handling,
 * error normalization, and secret-safe logging.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  ProviderDomain,
  ProviderName,
  ProviderErrorCode,
  RetryClassification,
  NormalizedProviderError,
  ProviderRequestContext,
  ProviderOperationType,
} from './provider.types';
import { ProviderPolicyService } from './provider-policy.service';

export interface OutboundRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  idempotencyKey?: string;
  correlationId: string;
  domain: ProviderDomain;
  provider: ProviderName;
  operation: ProviderOperationType;
  tenantId?: string;
  isIdempotent: boolean;
  signRequest?: (options: OutboundRequestOptions) => Promise<Record<string, string>>;
}

export interface OutboundResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  data: T;
  latencyMs: number;
  correlationId: string;
}

@Injectable()
export class ProviderRequestService {
  private readonly logger = new Logger(ProviderRequestService.name);

  constructor(private readonly policyService: ProviderPolicyService) {}

  async request<T>(options: OutboundRequestOptions): Promise<OutboundResponse<T>> {
    const start = Date.now();
    const timeoutMs = options.timeoutMs || this.policyService.getTimeout(options.domain, options.provider);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const safeHeaders = this.buildSafeHeaders(options);

    try {
      let finalHeaders = { ...safeHeaders };

      if (options.signRequest) {
        const signingHeaders = await options.signRequest(options);
        finalHeaders = { ...finalHeaders, ...signingHeaders };
      }

      if (options.idempotencyKey) {
        finalHeaders['Idempotency-Key'] = options.idempotencyKey;
        finalHeaders['X-Idempotency-Key'] = options.idempotencyKey;
      }

      finalHeaders['X-Correlation-Id'] = options.correlationId;
      finalHeaders['X-Request-Id'] = options.correlationId;

      const fetchOptions: RequestInit = {
        method: options.method,
        headers: finalHeaders as any,
        signal: controller.signal,
      };

      if (options.body && options.method !== 'GET') {
        fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        if (!finalHeaders['Content-Type']) {
          (fetchOptions.headers as any)['Content-Type'] = 'application/json';
        }
      }

      this.logSafeRequest(options);

      const response = await fetch(options.url, fetchOptions);
      clearTimeout(timeout);

      const latencyMs = Date.now() - start;
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      let data: T;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = (await response.json()) as T;
      } else {
        data = (await response.text()) as unknown as T;
      }

      if (!response.ok) {
        throw this.createErrorFromResponse(response.status, data, options, latencyMs);
      }

      this.logSafeResponse(options, response.status, latencyMs);

      return {
        status: response.status,
        headers: responseHeaders,
        data,
        latencyMs,
        correlationId: options.correlationId,
      };
    } catch (error) {
      clearTimeout(timeout);
      const latencyMs = Date.now() - start;

      if ((error as any).name === 'AbortError' || (error as Error).message.includes('abort')) {
        const timeoutError: NormalizedProviderError = {
          code: ProviderErrorCode.TIMEOUT,
          message: `Provider ${options.provider} request timeout after ${timeoutMs}ms`,
          provider: options.provider,
          domain: options.domain,
          isRetryable: false,
          retryClassification: RetryClassification.TIMEOUT_UNKNOWN_RESULT,
          httpStatus: 0,
          correlationId: options.correlationId,
          safeEvidence: {
            timeoutMs,
            latencyMs,
            url: this.redactUrl(options.url),
            method: options.method,
            operation: options.operation,
          },
        };
        this.logger.warn(`Provider timeout: ${options.provider} ${options.operation} ${timeoutError.message} correlationId=${options.correlationId}`);
        throw timeoutError;
      }

      if ((error as any).code && Object.values(ProviderErrorCode).includes((error as any).code)) {
        throw error;
      }

      const normalized = this.normalizeError(error as Error, options.provider, options.domain, options.correlationId);
      normalized.safeEvidence = {
        ...normalized.safeEvidence,
        latencyMs,
        url: this.redactUrl(options.url),
        method: options.method,
      };

      this.logger.warn(`Provider request failed: ${options.provider} ${options.operation} ${normalized.message} correlationId=${options.correlationId}`);
      throw normalized;
    }
  }

  async requestWithRetry<T>(options: OutboundRequestOptions): Promise<OutboundResponse<T>> {
    const retryPolicy = this.policyService.getRetryPolicy(options.domain, options.provider);
    let lastError: NormalizedProviderError | null = null;

    for (let attempt = 0; attempt <= retryPolicy.maxRetries; attempt++) {
      try {
        return await this.request<T>(options);
      } catch (error) {
        const normalized = error as NormalizedProviderError;
        lastError = normalized;

        const classification = this.classifyRetry(normalized, options);

        if (classification === RetryClassification.NO_RETRY || classification === RetryClassification.UNSAFE_RETRY) {
          throw normalized;
        }

        if (classification === RetryClassification.AUTH_FAILURE) {
          throw normalized;
        }

        if (attempt >= retryPolicy.maxRetries) {
          throw normalized;
        }

        if (classification === RetryClassification.RATE_LIMIT_RETRY) {
          const retryAfter = normalized.retryAfterMs || retryPolicy.initialDelayMs;
          await this.sleep(retryAfter);
          continue;
        }

        if (classification === RetryClassification.SAFE_RETRY || classification === RetryClassification.PROVIDER_UNAVAILABLE) {
          const delay = Math.min(
            retryPolicy.initialDelayMs * Math.pow(retryPolicy.backoffMultiplier, attempt),
            retryPolicy.maxDelayMs,
          );
          await this.sleep(delay);
          continue;
        }

        throw normalized;
      }
    }

    throw lastError;
  }

  classifyRetry(error: NormalizedProviderError, options: OutboundRequestOptions): RetryClassification {
    if (error.code === ProviderErrorCode.RATE_LIMITED) return RetryClassification.RATE_LIMIT_RETRY;
    if (error.code === ProviderErrorCode.AUTH_FAILED || error.code === ProviderErrorCode.INVALID_CREDENTIALS) {
      return RetryClassification.AUTH_FAILURE;
    }
    if (error.code === ProviderErrorCode.PROVIDER_UNAVAILABLE) return RetryClassification.PROVIDER_UNAVAILABLE;
    if (error.code === ProviderErrorCode.TIMEOUT) return RetryClassification.TIMEOUT_UNKNOWN_RESULT;

    if (error.httpStatus && error.httpStatus >= 500) {
      if (options.isIdempotent) return RetryClassification.SAFE_RETRY;
      return RetryClassification.TIMEOUT_UNKNOWN_RESULT;
    }

    if (error.httpStatus === 429) return RetryClassification.RATE_LIMIT_RETRY;

    if (error.httpStatus && error.httpStatus >= 400 && error.httpStatus < 500) {
      return RetryClassification.NO_RETRY;
    }

    return RetryClassification.NO_RETRY;
  }

  normalizeError(error: Error, provider: ProviderName, domain: ProviderDomain, correlationId: string): NormalizedProviderError {
    const message = error.message || 'Unknown provider error';
    let code = ProviderErrorCode.UNKNOWN;
    let httpStatus: number | undefined;
    let retryClassification = RetryClassification.NO_RETRY;
    let isRetryable = false;

    if (message.toLowerCase().includes('timeout') || message.toLowerCase().includes('abort')) {
      code = ProviderErrorCode.TIMEOUT;
      retryClassification = RetryClassification.TIMEOUT_UNKNOWN_RESULT;
      isRetryable = false;
    } else if (message.toLowerCase().includes('network') || message.toLowerCase().includes('econnrefused') || message.toLowerCase().includes('enotfound')) {
      code = ProviderErrorCode.NETWORK_ERROR;
      retryClassification = RetryClassification.PROVIDER_UNAVAILABLE;
      isRetryable = true;
    } else if (message.toLowerCase().includes('rate limit') || message.toLowerCase().includes('429')) {
      code = ProviderErrorCode.RATE_LIMITED;
      retryClassification = RetryClassification.RATE_LIMIT_RETRY;
      isRetryable = true;
    } else if (message.toLowerCase().includes('auth') || message.toLowerCase().includes('unauthorized') || message.toLowerCase().includes('401')) {
      code = ProviderErrorCode.AUTH_FAILED;
      retryClassification = RetryClassification.AUTH_FAILURE;
      isRetryable = false;
    } else if (message.toLowerCase().includes('not configured') || message.toLowerCase().includes('missing credential')) {
      code = ProviderErrorCode.NOT_CONFIGURED;
      retryClassification = RetryClassification.NO_RETRY;
      isRetryable = false;
    }

    return {
      code,
      message: message.slice(0, 500),
      provider,
      domain,
      isRetryable,
      retryClassification,
      httpStatus,
      correlationId,
      safeEvidence: {
        provider,
        domain,
        originalMessage: message.slice(0, 200),
      },
    };
  }

  private createErrorFromResponse(status: number, data: unknown, options: OutboundRequestOptions, latencyMs: number): NormalizedProviderError {
    let code = ProviderErrorCode.UNKNOWN;
    let retryClassification = RetryClassification.NO_RETRY;
    let isRetryable = false;
    let retryAfterMs: number | null = null;

    if (status === 401 || status === 403) {
      code = ProviderErrorCode.AUTH_FAILED;
      retryClassification = RetryClassification.AUTH_FAILURE;
    } else if (status === 429) {
      code = ProviderErrorCode.RATE_LIMITED;
      retryClassification = RetryClassification.RATE_LIMIT_RETRY;
      isRetryable = true;
      const dataAny = data as any;
      retryAfterMs = dataAny?.retry_after ? dataAny.retry_after * 1000 : 1000;
    } else if (status >= 500) {
      code = ProviderErrorCode.SERVER_ERROR;
      retryClassification = options.isIdempotent ? RetryClassification.SAFE_RETRY : RetryClassification.TIMEOUT_UNKNOWN_RESULT;
      isRetryable = options.isIdempotent;
    } else if (status === 404) {
      code = ProviderErrorCode.VALIDATION_ERROR;
      retryClassification = RetryClassification.NO_RETRY;
    } else if (status >= 400) {
      code = ProviderErrorCode.VALIDATION_ERROR;
      retryClassification = RetryClassification.NO_RETRY;
    }

    const message = `Provider ${options.provider} returned ${status}`;

    return {
      code,
      message,
      provider: options.provider,
      domain: options.domain,
      isRetryable,
      retryClassification,
      retryAfterMs,
      httpStatus: status,
      correlationId: options.correlationId,
      safeEvidence: {
        httpStatus: status,
        latencyMs,
        url: this.redactUrl(options.url),
        method: options.method,
        operation: options.operation,
        providerData: this.sanitizeProviderData(data),
      },
    };
  }

  private buildSafeHeaders(options: OutboundRequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': 'wlct-provider-adapter/1.0',
      'Accept': 'application/json',
      ...(options.headers || {}),
    };

    const forbiddenHeaders = ['authorization', 'x-api-key', 'api-key', 'private-key', 'secret'];
    for (const forbidden of forbiddenHeaders) {
      if (headers[forbidden]) {
        delete headers[forbidden];
      }
    }

    return headers;
  }

  private logSafeRequest(options: OutboundRequestOptions): void {
    this.logger.log(
      `Provider request: ${options.provider} ${options.domain} ${options.operation} ${options.method} ${this.redactUrl(options.url)} correlationId=${options.correlationId} idempotent=${options.isIdempotent}`,
    );
  }

  private logSafeResponse(options: OutboundRequestOptions, status: number, latencyMs: number): void {
    this.logger.log(`Provider response: ${options.provider} ${status} ${latencyMs}ms correlationId=${options.correlationId}`);
  }

  private redactUrl(url: string): string {
    if (!url) return 'unknown';
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    } catch {
      return url.split('?')[0].slice(0, 100);
    }
  }

  private sanitizeProviderData(data: unknown): unknown {
    if (!data || typeof data !== 'object') return null;
    const dataAny = data as any;
    const forbiddenKeys = ['api_key', 'apiKey', 'secret', 'private_key', 'privateKey', 'password', 'token', 'authorization', 'card', 'cvv', 'ssn', 'document', 'email', 'phone'];
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dataAny)) {
      const isForbidden = forbiddenKeys.some((fk) => key.toLowerCase().includes(fk.toLowerCase()));
      if (isForbidden) {
        sanitized[key] = '***REDACTED***';
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeProviderData(value);
      } else if (typeof value === 'string' && value.length > 500) {
        sanitized[key] = value.slice(0, 100) + '...TRUNCATED';
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
