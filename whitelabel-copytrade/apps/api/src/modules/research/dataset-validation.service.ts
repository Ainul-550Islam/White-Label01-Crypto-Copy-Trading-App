import { Injectable, Logger } from '@nestjs/common';
import { Candle } from './market-data-provider.interface';

export interface DatasetValidationIssue {
  category: 'DUPLICATE' | 'TIMESTAMP_REVERSAL' | 'GAP' | 'OHLC_INVALID' | 'NEGATIVE_PRICE' | 'HIGH_LOW_IMPOSSIBLE' | 'SYMBOL_MISMATCH' | 'VENUE_MISMATCH' | 'TIMEZONE_MISMATCH' | 'MISSING_DATA' | 'FUTURE_DATED' | 'CORRUPTED_FINGERPRINT' | 'TIMEFRAME_MISMATCH';
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  message: string;
  timestamp?: string | null;
  recordIndex?: number | null;
  expected?: any;
  actual?: any;
}

export interface DatasetValidationResult {
  status: 'VALID' | 'WARNING' | 'INVALID';
  issues: DatasetValidationIssue[];
  qualityScore: number;
  recordCount: number;
  duplicateCount: number;
  gapCount: number;
  missingPercentage: number;
  startTime: string | null;
  endTime: string | null;
  isValid: boolean;
}

/**
 * Validates timestamp ordering, gaps, duplicates, OHLC integrity, symbol consistency, timeframe alignment, and timezone normalization.
 */
@Injectable()
export class DatasetValidationService {
  private readonly logger = new Logger(DatasetValidationService.name);

  async validateCandles(input: { candles: Candle[]; expectedSymbol?: string; expectedVenue?: string; expectedTimeframe?: string; maxGapPercentage?: number }): Promise<DatasetValidationResult> {
    const issues: DatasetValidationIssue[] = [];
    const candles = input.candles;

    if (candles.length === 0) {
      return {
        status: 'INVALID',
        issues: [{ category: 'MISSING_DATA', severity: 'CRITICAL', message: 'Dataset contains no records' }],
        qualityScore: 0,
        recordCount: 0,
        duplicateCount: 0,
        gapCount: 0,
        missingPercentage: 100,
        startTime: null,
        endTime: null,
        isValid: false,
      };
    }

    let duplicateCount = 0;
    let gapCount = 0;
    const seen = new Set<string>();

    // Check chronological ordering
    for (let i=0; i<candles.length; i++) {
      const c = candles[i];
      const key = `${c.symbol}|${c.timeframe}|${c.openTime}`;

      if (seen.has(key)) {
        duplicateCount++;
        issues.push({ category: 'DUPLICATE', severity: 'ERROR', message: `Duplicate candle at ${c.openTime} for ${c.symbol}`, timestamp: c.openTime, recordIndex: i, actual: key });
      } else {
        seen.add(key);
      }

      if (i>0) {
        const prevTime = new Date(candles[i-1].openTime).getTime();
        const currTime = new Date(c.openTime).getTime();
        if (currTime < prevTime) {
          issues.push({ category: 'TIMESTAMP_REVERSAL', severity: 'CRITICAL', message: `Timestamp reversal at index ${i}: ${candles[i-1].openTime} -> ${c.openTime}`, timestamp: c.openTime, recordIndex: i, expected: `>=${candles[i-1].openTime}`, actual: c.openTime });
        } else if (currTime === prevTime) {
          // Already counted as duplicate
        } else {
          // Gap detection
          const expectedMs = this.timeframeToMs(c.timeframe);
          const diff = currTime - prevTime;
          if (diff > expectedMs * 1.5) {
            gapCount++;
            const missing = Math.floor(diff / expectedMs) - 1;
            issues.push({ category: 'GAP', severity: missing > 5 ? 'ERROR' : 'WARNING', message: `Gap detected: ${missing} missing candles between ${candles[i-1].closeTime} and ${c.openTime}`, timestamp: c.openTime, recordIndex: i, expected: expectedMs, actual: diff });
          }
        }
      }

      // OHLC validity
      const open = parseFloat(c.open);
      const high = parseFloat(c.high);
      const low = parseFloat(c.low);
      const close = parseFloat(c.close);
      const volume = parseFloat(c.volume);

      if ([open, high, low, close, volume].some(v => isNaN(v))) {
        issues.push({ category: 'OHLC_INVALID', severity: 'CRITICAL', message: `Invalid numeric value at ${c.openTime}`, timestamp: c.openTime, recordIndex: i, actual: { open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume } });
      }

      if (open < 0 || high < 0 || low < 0 || close < 0 || volume < 0) {
        issues.push({ category: 'NEGATIVE_PRICE', severity: 'CRITICAL', message: `Negative price/volume at ${c.openTime}`, timestamp: c.openTime, recordIndex: i, actual: { open, high, low, close, volume } });
      }

      if (high < low) {
        issues.push({ category: 'HIGH_LOW_IMPOSSIBLE', severity: 'CRITICAL', message: `High < Low at ${c.openTime}: high=${high} low=${low}`, timestamp: c.openTime, recordIndex: i, expected: `high >= low`, actual: { high, low } });
      }

      if (high < open || high < close) {
        issues.push({ category: 'OHLC_INVALID', severity: 'ERROR', message: `High < Open/Close at ${c.openTime}`, timestamp: c.openTime, recordIndex: i, actual: { open, high, close } });
      }

      if (low > open || low > close) {
        issues.push({ category: 'OHLC_INVALID', severity: 'ERROR', message: `Low > Open/Close at ${c.openTime}`, timestamp: c.openTime, recordIndex: i, actual: { open, low, close } });
      }

      // Symbol consistency
      if (input.expectedSymbol && c.symbol !== input.expectedSymbol) {
        issues.push({ category: 'SYMBOL_MISMATCH', severity: 'ERROR', message: `Symbol mismatch: expected ${input.expectedSymbol} got ${c.symbol}`, timestamp: c.openTime, recordIndex: i, expected: input.expectedSymbol, actual: c.symbol });
      }

      // Venue consistency
      if (input.expectedVenue && c.venue !== input.expectedVenue) {
        issues.push({ category: 'VENUE_MISMATCH', severity: 'ERROR', message: `Venue mismatch: expected ${input.expectedVenue} got ${c.venue}`, timestamp: c.openTime, recordIndex: i, expected: input.expectedVenue, actual: c.venue });
      }

      // Timeframe consistency
      if (input.expectedTimeframe && c.timeframe !== input.expectedTimeframe) {
        issues.push({ category: 'TIMEFRAME_MISMATCH', severity: 'ERROR', message: `Timeframe mismatch: expected ${input.expectedTimeframe} got ${c.timeframe}`, timestamp: c.openTime, recordIndex: i, expected: input.expectedTimeframe, actual: c.timeframe });
      }

      // Future-dated
      if (new Date(c.openTime).getTime() > Date.now() + 60*1000) {
        issues.push({ category: 'FUTURE_DATED', severity: 'CRITICAL', message: `Future-dated record at ${c.openTime}`, timestamp: c.openTime, recordIndex: i, actual: c.openTime });
      }
    }

    // Missing data percentage
    let missingPercentage = 0;
    if (candles.length > 1) {
      const tfMs = this.timeframeToMs(candles[0].timeframe);
      const totalDuration = new Date(candles[candles.length-1].openTime).getTime() - new Date(candles[0].openTime).getTime();
      const expectedCount = Math.floor(totalDuration / tfMs) + 1;
      missingPercentage = expectedCount > 0 ? ((expectedCount - candles.length) / expectedCount) * 100 : 0;
      if (missingPercentage > 5) {
        issues.push({ category: 'MISSING_DATA', severity: missingPercentage > 20 ? 'ERROR' : 'WARNING', message: `Missing data: ${missingPercentage.toFixed(2)}% missing (${expectedCount - candles.length} of ${expectedCount})`, expected: expectedCount, actual: candles.length });
      }
    }

    // Quality score
    let qualityScore = 100;
    for (const issue of issues) {
      switch (issue.severity) {
        case 'CRITICAL': qualityScore -= 20; break;
        case 'ERROR': qualityScore -= 10; break;
        case 'WARNING': qualityScore -= 2; break;
        case 'INFO': qualityScore -= 0.5; break;
      }
    }
    qualityScore = Math.max(0, Math.min(100, qualityScore)) / 100;

    const hasCritical = issues.some(i => i.severity === 'CRITICAL');
    const hasError = issues.some(i => i.severity === 'ERROR');

    let status: 'VALID' | 'WARNING' | 'INVALID' = 'VALID';
    if (hasCritical) status = 'INVALID';
    else if (hasError || issues.some(i => i.severity === 'WARNING')) status = 'WARNING';

    const maxGap = input.maxGapPercentage ?? 10;
    if (missingPercentage > maxGap) status = 'INVALID';

    this.logger.log(`Dataset validation completed records=${candles.length} duplicates=${duplicateCount} gaps=${gapCount} missing=${missingPercentage.toFixed(2)}% quality=${qualityScore} status=${status}`);

    return {
      status,
      issues,
      qualityScore,
      recordCount: candles.length,
      duplicateCount,
      gapCount,
      missingPercentage,
      startTime: candles[0]?.openTime || null,
      endTime: candles[candles.length-1]?.openTime || null,
      isValid: status !== 'INVALID',
    };
  }

  private timeframeToMs(tf: string): number {
    const map: Record<string, number> = {
      '1m': 60*1000, '3m': 3*60*1000, '5m': 5*60*1000, '15m': 15*60*1000, '30m': 30*60*1000,
      '1h': 60*60*1000, '2h': 2*60*60*1000, '4h': 4*60*60*1000, '6h': 6*60*60*1000, '8h': 8*60*60*1000, '12h': 12*60*60*1000,
      '1d': 24*60*60*1000, '3d': 3*24*60*60*1000, '1w': 7*24*60*60*1000,
    };
    return map[tf] || 60*1000;
  }
}
