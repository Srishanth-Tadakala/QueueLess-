/**
 * QueueLess Historical Service Duration Analytics & Rolling Average Engine
 * Source of truth: docs/requirements.md (Version 1.2.0, Section 6.3 - Stage B)
 *
 * Responsibilities:
 * 1. Extract valid completed service durations from token history.
 * 2. Enforce timestamp validity: completedAt > calledAt > 0.
 * 3. Enforce strict status eligibility: ONLY tokens in COMPLETED status.
 * 4. Apply duration clamping to [1.0, 20.0] minutes.
 * 5. Compute rolling arithmetic mean over the newest M <= 5 completed transactions.
 * 6. Provide clear data sufficiency and estimation method metadata.
 * 7. Gracefully fall back to Stage A service baseline when history is absent or empty.
 */

import { APPROVED_SERVICES } from './services.js';
import { TOKEN_STATUS } from './queueModel.js';

export const ESTIMATION_METHOD = Object.freeze({
  STAGE_A_BASELINE: 'STAGE_A_BASELINE',
  STAGE_B_ROLLING_AVERAGE: 'STAGE_B_ROLLING_AVERAGE'
});

export const DATA_SUFFICIENCY = Object.freeze({
  NO_HISTORY: 'NO_HISTORY',
  INSUFFICIENT_HISTORY: 'INSUFFICIENT_HISTORY',
  SUFFICIENT_HISTORY: 'SUFFICIENT_HISTORY'
});

export const SAMPLE_WINDOW_SIZE = 5;
export const MIN_DURATION_CLAMP_MINUTES = 1.0;
export const MAX_DURATION_CLAMP_MINUTES = 20.0;

/**
 * Checks whether a token is eligible for historical service duration calculation.
 *
 * Eligibility Rules (Section 6.3):
 * - status === COMPLETED
 * - calledAt is a valid positive number
 * - completedAt is a valid positive number
 * - completedAt > calledAt
 * - serviceId belongs to the approved service catalog
 *
 * Explicitly excluded:
 * - WAITING, SERVING, SKIPPED, CANCELLED
 * - Zero or negative durations (completedAt <= calledAt)
 * - Invalid, null, non-numeric timestamps
 * - Unknown or invalid serviceId
 *
 * Invariant: Service duration measures actual counter-serving time (completedAt - calledAt),
 * never total queue waiting time from createdAt.
 *
 * @param {object} token
 * @returns {boolean}
 */
export function isEligibleCompletedToken(token) {
  if (!token || typeof token !== 'object') {
    return false;
  }

  if (token.status !== TOKEN_STATUS.COMPLETED) {
    return false;
  }

  if (typeof token.calledAt !== 'number' || isNaN(token.calledAt) || token.calledAt <= 0) {
    return false;
  }

  if (typeof token.completedAt !== 'number' || isNaN(token.completedAt) || token.completedAt <= 0) {
    return false;
  }

  if (token.completedAt <= token.calledAt) {
    return false;
  }

  if (!APPROVED_SERVICES.some((s) => s.id === token.serviceId)) {
    return false;
  }

  return true;
}

/**
 * Calculates clamped service duration in minutes for an eligible completed token.
 * Measures actual counter-serving time: (completedAt - calledAt) / 60000.
 * Clamped strictly to [1.0, 20.0] minutes.
 *
 * @param {object} token
 * @returns {number|null} Clamped duration in minutes, or null if ineligible
 */
export function extractTokenDurationMinutes(token) {
  if (!isEligibleCompletedToken(token)) {
    return null;
  }

  const rawMinutes = (token.completedAt - token.calledAt) / 60000;
  if (rawMinutes <= 0 || isNaN(rawMinutes)) {
    return null;
  }

  return Math.min(
    MAX_DURATION_CLAMP_MINUTES,
    Math.max(MIN_DURATION_CLAMP_MINUTES, rawMinutes)
  );
}

/**
 * Extracts and filters all valid historical completed transactions for a service,
 * sorted newest first by completedAt descending.
 *
 * @param {string} serviceId
 * @param {Array<object>} tokens - State tokens array
 * @returns {Array<{
 *   tokenId: string,
 *   tokenNumber: string,
 *   serviceId: string,
 *   calledAt: number,
 *   completedAt: number,
 *   rawMinutes: number,
 *   durationMinutes: number
 * }>}
 */
export function getValidCompletedTransactions(serviceId, tokens = []) {
  if (!serviceId || !Array.isArray(tokens)) {
    return [];
  }

  const validTransactions = [];

  for (const token of tokens) {
    if (token.serviceId === serviceId && isEligibleCompletedToken(token)) {
      const rawMinutes = (token.completedAt - token.calledAt) / 60000;
      const durationMinutes = Math.min(
        MAX_DURATION_CLAMP_MINUTES,
        Math.max(MIN_DURATION_CLAMP_MINUTES, rawMinutes)
      );

      validTransactions.push({
        tokenId: token.id,
        tokenNumber: token.tokenNumber,
        serviceId: token.serviceId,
        calledAt: token.calledAt,
        completedAt: token.completedAt,
        rawMinutes,
        durationMinutes
      });
    }
  }

  // Sort newest first by completedAt descending (with deterministic ID tie-breaking)
  validTransactions.sort((a, b) => {
    if (b.completedAt !== a.completedAt) {
      return b.completedAt - a.completedAt;
    }
    return String(b.tokenId || '').localeCompare(String(a.tokenId || ''));
  });

  return validTransactions;
}

/**
 * Calculates the Stage B rolling average service duration for a given service.
 *
 * Formula (Section 6.3):
 * T_average = (d1 + d2 + ... + dn) / n
 * where n = min(5, number of valid completed transactions).
 *
 * When no valid history exists (n = 0):
 * Falls back to Stage A baseline: T_baseline.
 *
 * @param {string} serviceId - 'admissions' | 'finance' | 'examinations'
 * @param {Array<object>|object} tokensOrState - Tokens array or queue state object
 * @returns {{
 *   serviceId: string,
 *   serviceName: string,
 *   baselineMinutes: number,
 *   rollingAverageMinutes: number|null,
 *   effectiveDurationMinutes: number,
 *   sampleCount: number,
 *   totalValidTransactions: number,
 *   sampleWindow: number,
 *   isUsingFallback: boolean,
 *   estimationMethod: string,
 *   dataSufficiency: string,
 *   recentDurations: number[],
 *   recentSamples: Array<{ tokenNumber: string, durationMinutes: number, completedAt: number }>
 * }}
 */
export function calculateRollingAverage(serviceId, tokensOrState) {
  const service = APPROVED_SERVICES.find((s) => s.id === serviceId);
  const baselineMinutes = service ? service.baselineDurationMinutes : 5;
  const serviceName = service ? service.name : serviceId;

  const tokens = Array.isArray(tokensOrState)
    ? tokensOrState
    : Array.isArray(tokensOrState?.tokens)
    ? tokensOrState.tokens
    : [];

  const allValid = getValidCompletedTransactions(serviceId, tokens);
  const totalValidTransactions = allValid.length;

  // Window: up to 5 newest completed transactions
  const windowSamples = allValid.slice(0, SAMPLE_WINDOW_SIZE);
  const sampleCount = windowSamples.length;

  if (sampleCount === 0) {
    return {
      serviceId,
      serviceName,
      baselineMinutes,
      rollingAverageMinutes: null,
      effectiveDurationMinutes: baselineMinutes,
      sampleCount: 0,
      totalValidTransactions: 0,
      sampleWindow: SAMPLE_WINDOW_SIZE,
      isUsingFallback: true,
      estimationMethod: ESTIMATION_METHOD.STAGE_A_BASELINE,
      dataSufficiency: DATA_SUFFICIENCY.NO_HISTORY,
      recentDurations: [],
      recentSamples: []
    };
  }

  const sumClamped = windowSamples.reduce((acc, s) => acc + s.durationMinutes, 0);
  const rawMean = sumClamped / sampleCount;
  // Round mean to 2 decimal places for precise display and calculation
  const rollingAverageMinutes = Math.round(rawMean * 100) / 100;

  const dataSufficiency = sampleCount >= SAMPLE_WINDOW_SIZE
    ? DATA_SUFFICIENCY.SUFFICIENT_HISTORY
    : DATA_SUFFICIENCY.INSUFFICIENT_HISTORY;

  return {
    serviceId,
    serviceName,
    baselineMinutes,
    rollingAverageMinutes,
    effectiveDurationMinutes: rollingAverageMinutes,
    sampleCount,
    totalValidTransactions,
    sampleWindow: SAMPLE_WINDOW_SIZE,
    isUsingFallback: false,
    estimationMethod: ESTIMATION_METHOD.STAGE_B_ROLLING_AVERAGE,
    dataSufficiency,
    recentDurations: windowSamples.map((s) => Math.round(s.durationMinutes * 100) / 100),
    recentSamples: windowSamples.map((s) => ({
      tokenNumber: s.tokenNumber,
      durationMinutes: Math.round(s.durationMinutes * 100) / 100,
      completedAt: s.completedAt
    }))
  };
}

/**
 * Calculates rolling average analytics for all approved services simultaneously.
 * Useful for the admin dashboard analytics panel.
 *
 * @param {Array<object>|object} tokensOrState
 * @returns {Record<string, object>}
 */
export function getAllServicesAnalytics(tokensOrState) {
  const analytics = {};
  for (const service of APPROVED_SERVICES) {
    analytics[service.id] = calculateRollingAverage(service.id, tokensOrState);
  }
  return analytics;
}

