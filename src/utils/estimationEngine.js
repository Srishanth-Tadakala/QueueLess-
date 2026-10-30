/**
 * QueueLess Queue-Position & Stage A Waiting-Time Estimation Engine
 * Source of truth: docs/requirements.md (Version 1.2.0, Section 6)
 *
 * Enforces:
 * 1. Strict FIFO ordering for waiting tokens with deterministic tie-breaking.
 * 2. Unambiguous distinction between queue position (P) and waiting tokens ahead (N_ahead).
 * 3. Two-branch Stage A baseline waiting-time estimation formula.
 * 4. Explicit zero-wait interpretation: indicates counter readiness, not instant transaction completion.
 * 5. Safe handling of empty queues, missing tokens, and terminal token states.
 */

import { APPROVED_SERVICES } from './services.js';
import { TOKEN_STATUS } from './queueModel.js';
import {
  calculateRollingAverage,
  getAllServicesAnalytics,
  ESTIMATION_METHOD,
  DATA_SUFFICIENCY
} from './durationAnalytics.js';

/**
 * Deterministic FIFO comparator for waiting tokens.
 * Primary sort: createdAt ascending.
 * Tie-breaker: unique id string ascending.
 */
function compareTokensFIFO(a, b) {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt - b.createdAt;
  }
  return String(a.id || '').localeCompare(String(b.id || ''));
}

/**
 * Extracts and orders the active counter state for a given service.
 *
 * @param {object} state - Queue state
 * @param {string} serviceId - 'admissions' | 'finance' | 'examinations'
 * @returns {{ servingToken: object|null, waitingTokens: object[], totalWaiting: number }}
 */
export function getServiceQueue(state, serviceId) {
  if (!state || !Array.isArray(state.tokens)) {
    return { servingToken: null, waitingTokens: [], totalWaiting: 0 };
  }

  let servingToken = null;
  const waitingTokens = [];

  for (const token of state.tokens) {
    if (token.serviceId === serviceId) {
      if (token.status === TOKEN_STATUS.SERVING && !servingToken) {
        servingToken = token;
      } else if (token.status === TOKEN_STATUS.WAITING) {
        waitingTokens.push(token);
      }
      // COMPLETED, SKIPPED, CANCELLED are strictly excluded from active waiting queue
    }
  }

  waitingTokens.sort(compareTokensFIFO);

  return {
    servingToken,
    waitingTokens,
    totalWaiting: waitingTokens.length
  };
}

/**
 * Calculates the exact queue position and count of waiting tokens ahead.
 *
 * Definitions (Section 6.1):
 * - N_ahead: Count of eligible WAITING tokens preceding target token for same service.
 * - P: Human-readable ordinal position (N_ahead + 1 for WAITING, 'Now Serving' for SERVING).
 *
 * @param {object|string} tokenOrId - Token object or token ID
 * @param {object} state - Current queue state
 * @returns {{
 *   token: object|null,
 *   status: string,
 *   position: number|string|null,
 *   waitingAhead: number|null,
 *   isServing: boolean,
 *   isNextInLine: boolean,
 *   isEligible: boolean,
 *   displayText: string
 * }}
 */
export function calculateQueuePosition(tokenOrId, state) {
  if (!state || !Array.isArray(state.tokens)) {
    return {
      token: null,
      status: 'UNAVAILABLE',
      position: null,
      waitingAhead: null,
      isServing: false,
      isNextInLine: false,
      isEligible: false,
      displayText: 'Queue data unavailable'
    };
  }

  const token = typeof tokenOrId === 'string'
    ? state.tokens.find((t) => t.id === tokenOrId)
    : tokenOrId;

  if (!token) {
    return {
      token: null,
      status: 'NOT_FOUND',
      position: null,
      waitingAhead: null,
      isServing: false,
      isNextInLine: false,
      isEligible: false,
      displayText: 'Token not found'
    };
  }

  // 1. Serving Customer
  if (token.status === TOKEN_STATUS.SERVING) {
    return {
      token,
      status: TOKEN_STATUS.SERVING,
      position: 'Now Serving',
      waitingAhead: 0,
      isServing: true,
      isNextInLine: true,
      isEligible: true,
      displayText: 'Now Serving — Please proceed to counter'
    };
  }

  // 2. Terminal or Non-Waiting States
  if (token.status === TOKEN_STATUS.COMPLETED) {
    return {
      token,
      status: TOKEN_STATUS.COMPLETED,
      position: null,
      waitingAhead: null,
      isServing: false,
      isNextInLine: false,
      isEligible: false,
      displayText: 'Service completed'
    };
  }

  if (token.status === TOKEN_STATUS.SKIPPED) {
    return {
      token,
      status: TOKEN_STATUS.SKIPPED,
      position: null,
      waitingAhead: null,
      isServing: false,
      isNextInLine: false,
      isEligible: false,
      displayText: 'Absent / Skipped by counter'
    };
  }

  if (token.status === TOKEN_STATUS.CANCELLED) {
    return {
      token,
      status: TOKEN_STATUS.CANCELLED,
      position: null,
      waitingAhead: null,
      isServing: false,
      isNextInLine: false,
      isEligible: false,
      displayText: 'Ticket cancelled'
    };
  }

  // 3. Waiting Token Position Calculation
  if (token.status === TOKEN_STATUS.WAITING) {
    const { waitingTokens } = getServiceQueue(state, token.serviceId);
    const index = waitingTokens.findIndex((t) => t.id === token.id);

    if (index === -1) {
      // Token marked WAITING but not found in active list (fallback guard)
      return {
        token,
        status: TOKEN_STATUS.WAITING,
        position: 1,
        waitingAhead: 0,
        isServing: false,
        isNextInLine: true,
        isEligible: true,
        displayText: 'Position: #1 (Next in line)'
      };
    }

    const waitingAhead = index;
    const position = index + 1;
    const isNextInLine = position === 1;

    let displayText = `Position: #${position} in line`;
    if (isNextInLine) {
      displayText = 'Position: #1 (Next in line)';
    }

    return {
      token,
      status: TOKEN_STATUS.WAITING,
      position,
      waitingAhead,
      isServing: false,
      isNextInLine,
      isEligible: true,
      displayText
    };
  }

  return {
    token,
    status: token.status,
    position: null,
    waitingAhead: null,
    isServing: false,
    isNextInLine: false,
    isEligible: false,
    displayText: `Status: ${token.status}`
  };
}

/**
 * Calculates Stage A Baseline Estimated Waiting Time.
 *
 * Formula (Section 6.2):
 * If a token is currently being served:
 *   EstimatedWait = RemainingCurrentService + (WaitingTokensAhead * EstimatedServiceDuration)
 * If no token is currently being served:
 *   EstimatedWait = WaitingTokensAhead * EstimatedServiceDuration
 *
 * Where:
 * - EstimatedServiceDuration = T_baseline for the service
 * - RemainingCurrentService = max(0, T_baseline - elapsedServingMinutes)
 *
 * @param {object|string} tokenOrId - Token object or token ID
 * @param {object} state - Current queue state
 * @param {number} [currentTime=Date.now()] - Wall-clock timestamp (ms) for deterministic evaluation
 * @returns {{
 *   estimatedMinutes: number|null,
 *   rawWaitMinutes: number|null,
 *   remainingCurrentService: number,
 *   baselineDuration: number,
 *   displayText: string,
 *   statusWording: string,
 *   isReadyNow: boolean,
 *   isServing: boolean
 * }}
 */
export function calculateStageAWaitTime(tokenOrId, state, currentTime = Date.now()) {
  const positionInfo = calculateQueuePosition(tokenOrId, state);
  const token = positionInfo.token;

  // Handle missing or ineligible tokens
  if (!token || !positionInfo.isEligible) {
    return {
      estimatedMinutes: null,
      rawWaitMinutes: null,
      remainingCurrentService: 0,
      baselineDuration: 0,
      displayText: 'N/A',
      statusWording: positionInfo.displayText,
      isReadyNow: false,
      isServing: false
    };
  }

  // Handle customer currently at counter
  if (token.status === TOKEN_STATUS.SERVING) {
    return {
      estimatedMinutes: 0,
      rawWaitMinutes: 0,
      remainingCurrentService: 0,
      baselineDuration: 0,
      displayText: 'At Counter',
      statusWording: 'Now Serving — Please proceed to counter',
      isReadyNow: false,
      isServing: true
    };
  }

  const service = APPROVED_SERVICES.find((s) => s.id === token.serviceId);
  const baselineDuration = service ? service.baselineDurationMinutes : 5;
  const waitingAhead = positionInfo.waitingAhead !== null ? positionInfo.waitingAhead : 0;

  const { servingToken } = getServiceQueue(state, token.serviceId);

  let remainingCurrentService = 0;
  let rawWaitMinutes = 0;

  if (servingToken) {
    // Branch 1: Counter is currently serving a customer
    const calledAt = servingToken.calledAt || currentTime;
    const elapsedMinutes = Math.max(0, (currentTime - calledAt) / 60000);
    remainingCurrentService = Math.max(0, baselineDuration - elapsedMinutes);
    rawWaitMinutes = remainingCurrentService + (waitingAhead * baselineDuration);
  } else {
    // Branch 2: No customer is currently being served
    remainingCurrentService = 0;
    rawWaitMinutes = waitingAhead * baselineDuration;
  }

  const estimatedMinutes = Math.round(rawWaitMinutes);

  // Standardized UI wording (Section 6.2)
  let displayText = '';
  let statusWording = '';
  let isReadyNow = false;

  if (!servingToken && waitingAhead === 0) {
    // Zero-wait semantics: Counter is ready for immediate call
    isReadyNow = true;
    displayText = '0 min (Ready now)';
    statusWording = 'You are next in line — Counter is ready to call you';
  } else if (servingToken && waitingAhead === 0) {
    displayText = estimatedMinutes <= 0
      ? '< 1 min (Until call)'
      : `~${estimatedMinutes} min (Until call)`;
    statusWording = 'You are next in line — Please remain near counter';
  } else {
    displayText = `~${estimatedMinutes} min estimated`;
    statusWording = `Position #${positionInfo.position} — ${waitingAhead === 1 ? '1 waiting token' : `${waitingAhead} waiting tokens`} ahead of you`;
  }

  return {
    estimatedMinutes,
    rawWaitMinutes,
    remainingCurrentService,
    baselineDuration,
    displayText,
    statusWording,
    isReadyNow,
    isServing: false
  };
}

/**
 * Calculates Stage B Adaptive Estimated Waiting Time using rolling average duration.
 *
 * Formula (Section 6.2 & 6.3):
 * If a token is currently being served:
 *   EstimatedWait = RemainingCurrentService + (WaitingTokensAhead * EstimatedServiceDuration)
 * If no token is currently being served:
 *   EstimatedWait = WaitingTokensAhead * EstimatedServiceDuration
 *
 * Where:
 * - EstimatedServiceDuration = rolling average duration of last M <= 5 completed transactions
 *   (or T_baseline if M = 0)
 * - RemainingCurrentService = max(0, EstimatedServiceDuration - elapsedServingMinutes)
 *
 * @param {object|string} tokenOrId - Token object or token ID
 * @param {object} state - Current queue state
 * @param {number} [currentTime=Date.now()] - Wall-clock timestamp (ms)
 * @returns {object} Stage B estimation metadata and display wording
 */
export function calculateStageBWaitTime(tokenOrId, state, currentTime = Date.now()) {
  const positionInfo = calculateQueuePosition(tokenOrId, state);
  const token = positionInfo.token;

  if (!token || !positionInfo.isEligible) {
    return {
      estimatedMinutes: null,
      estimatedWaitMinutes: null,
      rawWaitMinutes: null,
      remainingCurrentService: 0,
      estimatedServiceDuration: 0,
      baselineDuration: 0,
      baselineMinutes: 0,
      rollingAverageMinutes: null,
      sampleCount: 0,
      sampleWindow: 5,
      isUsingFallback: true,
      estimationMethod: ESTIMATION_METHOD.STAGE_A_BASELINE,
      dataSufficiency: DATA_SUFFICIENCY.NO_HISTORY,
      recentDurations: [],
      displayText: 'N/A',
      statusWording: positionInfo.displayText,
      isReadyNow: false,
      isServing: false,
      disclosure: 'Queue data unavailable.'
    };
  }

  if (token.status === TOKEN_STATUS.SERVING) {
    return {
      estimatedMinutes: 0,
      estimatedWaitMinutes: 0,
      rawWaitMinutes: 0,
      remainingCurrentService: 0,
      estimatedServiceDuration: 0,
      baselineDuration: 0,
      baselineMinutes: 0,
      rollingAverageMinutes: null,
      sampleCount: 0,
      sampleWindow: 5,
      isUsingFallback: false,
      estimationMethod: ESTIMATION_METHOD.STAGE_A_BASELINE,
      dataSufficiency: DATA_SUFFICIENCY.NO_HISTORY,
      recentDurations: [],
      displayText: 'At Counter',
      statusWording: 'Now Serving — Please proceed to counter',
      isReadyNow: false,
      isServing: true,
      disclosure: 'You are currently being served at the counter.'
    };
  }

  const analytics = calculateRollingAverage(token.serviceId, state);
  const baselineDuration = analytics.baselineMinutes;
  const estimatedServiceDuration = analytics.effectiveDurationMinutes;
  const waitingAhead = positionInfo.waitingAhead !== null ? positionInfo.waitingAhead : 0;

  const { servingToken } = getServiceQueue(state, token.serviceId);

  let remainingCurrentService = 0;
  let rawWaitMinutes = 0;

  if (servingToken) {
    // Branch 1: Counter is currently serving a customer
    const calledAt = servingToken.calledAt || currentTime;
    const elapsedMinutes = Math.max(0, (currentTime - calledAt) / 60000);
    remainingCurrentService = Math.max(0, estimatedServiceDuration - elapsedMinutes);
    rawWaitMinutes = remainingCurrentService + (waitingAhead * estimatedServiceDuration);
  } else {
    // Branch 2: No customer is currently being served
    remainingCurrentService = 0;
    rawWaitMinutes = waitingAhead * estimatedServiceDuration;
  }

  const estimatedMinutes = Math.round(rawWaitMinutes);

  let displayText = '';
  let statusWording = '';
  let isReadyNow = false;

  if (!servingToken && waitingAhead === 0) {
    isReadyNow = true;
    displayText = '0 min (Ready now)';
    statusWording = 'You are next in line — Counter is ready to call you';
  } else if (servingToken && waitingAhead === 0) {
    displayText = estimatedMinutes <= 0
      ? '< 1 min (Until call)'
      : `~${estimatedMinutes} min (Until call)`;
    statusWording = 'You are next in line — Please remain near counter';
  } else {
    displayText = `~${estimatedMinutes} min estimated`;
    statusWording = `Position #${positionInfo.position} — ${waitingAhead === 1 ? '1 waiting token' : `${waitingAhead} waiting tokens`} ahead of you`;
  }

  let disclosure = '';
  if (analytics.isUsingFallback) {
    disclosure = `Using standard service duration (${baselineDuration} min baseline). Historical data: Not available.`;
  } else {
    disclosure = `Based on recent completed transactions (${analytics.rollingAverageMinutes} min rolling avg, ${analytics.sampleCount} ${analytics.sampleCount === 1 ? 'sample' : 'samples'}).`;
  }

  return {
    estimatedMinutes,
    estimatedWaitMinutes: estimatedMinutes,
    rawWaitMinutes,
    remainingCurrentService: Math.round(remainingCurrentService * 100) / 100,
    estimatedServiceDuration,
    baselineDuration,
    baselineMinutes: baselineDuration,
    rollingAverageMinutes: analytics.rollingAverageMinutes,
    sampleCount: analytics.sampleCount,
    sampleWindow: analytics.sampleWindow,
    isUsingFallback: analytics.isUsingFallback,
    estimationMethod: analytics.estimationMethod,
    dataSufficiency: analytics.dataSufficiency,
    recentDurations: analytics.recentDurations,
    displayText,
    statusWording,
    isReadyNow,
    isServing: false,
    disclosure
  };
}

/**
 * Combines position, wait time estimation, and display metadata into a unified object.
 * Uses Stage B adaptive estimation (with Stage A baseline fallback).
 *
 * @param {object|string} tokenOrId - Token or ID
 * @param {object} state - Queue state
 * @param {number} [currentTime=Date.now()] - Timestamp
 * @returns {object} Unified metrics
 */
export function getQueueMetrics(tokenOrId, state, currentTime = Date.now()) {
  const positionInfo = calculateQueuePosition(tokenOrId, state);
  const waitInfo = calculateStageBWaitTime(tokenOrId, state, currentTime);

  return {
    ...positionInfo,
    ...waitInfo,
    serviceTitle: positionInfo.token ? positionInfo.token.serviceName : ''
  };
}

export {
  calculateRollingAverage,
  getAllServicesAnalytics,
  ESTIMATION_METHOD,
  DATA_SUFFICIENCY
};
