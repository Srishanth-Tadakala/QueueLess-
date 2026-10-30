/**
 * QueueLess Administrator Queue-Dispatch Engine
 * Source of truth: docs/requirements.md (Version 1.2.0, Section 5 & 7)
 *
 * Implements pure, testable dispatcher actions:
 * 1. Call Next: Transitions head FIFO waiting token to SERVING (guarded against concurrent serving).
 * 2. Mark Complete: Transitions serving token to COMPLETED (records completedAt).
 * 3. Skip: Transitions serving token to SKIPPED (records skippedAt).
 * 4. Re-queue: Appends skipped token to the tail of the WAITING line with reset timestamps.
 * 5. Pause / Resume: Controls desk intake status while preserving existing waiting tokens.
 * 6. Reset Service / Reset All: Clears queues and resets sequence numbers to 0 (next token: 001).
 */

import { APPROVED_SERVICES } from './services.js';
import {
  TOKEN_STATUS,
  SERVICE_STATUS,
  applyTransition,
  setServiceStatus,
  createInitialState
} from './queueModel.js';
import {
  getServiceQueue
} from './estimationEngine.js';
import {
  getStorageEngine,
  saveQueueState
} from './storage.js';
import {
  getSessionTokenId,
  clearSessionTokenId
} from './tokenIssuance.js';

/**
 * Dispatches the next waiting token to the service counter.
 *
 * Rules:
 * - Selects first token from FIFO waiting queue (createdAt ascending with ID tie-breaking).
 * - Rejects if another token for this service is currently SERVING.
 * - Rejects if queue is empty.
 * - Leaves other services unmodified.
 * - Persists state before reporting success.
 *
 * @param {object} params
 * @param {object} params.state - Current queue state
 * @param {string} params.serviceId - Service identifier
 * @param {Storage|object|null} [params.storage] - Storage engine
 * @param {number} [params.timestamp=Date.now()] - Timestamp
 * @returns {{ success: boolean, token?: object, state: object, error?: string, code?: string }}
 */
export function callNextToken({
  state,
  serviceId,
  storage = null,
  timestamp = Date.now()
}) {
  const service = APPROVED_SERVICES.find((s) => s.id === serviceId);
  if (!service) {
    return {
      success: false,
      error: `Invalid service ID: "${serviceId}".`,
      code: 'INVALID_SERVICE',
      state
    };
  }

  const { servingToken, waitingTokens } = getServiceQueue(state, serviceId);

  // Guard 1: Cannot call next if counter is already serving
  if (servingToken) {
    return {
      success: false,
      error: `Cannot call token: Counter is currently SERVING customer ${servingToken.tokenNumber}. Complete or skip current customer first.`,
      code: 'COUNTER_OCCUPIED',
      servingToken,
      state
    };
  }

  // Guard 2: Cannot call next if queue is empty
  if (waitingTokens.length === 0) {
    return {
      success: false,
      error: `Queue is empty for ${service.name}. No waiting customers to call.`,
      code: 'QUEUE_EMPTY',
      state
    };
  }

  const nextToken = waitingTokens[0];
  const transitionResult = applyTransition(state, nextToken.id, TOKEN_STATUS.SERVING, timestamp);

  if (!transitionResult.success) {
    return {
      success: false,
      error: transitionResult.reason,
      code: 'TRANSITION_REJECTED',
      state
    };
  }

  // Persist state
  const targetStorage = storage !== null ? storage : getStorageEngine();
  if (targetStorage) {
    const saveResult = saveQueueState(transitionResult.state, targetStorage);
    if (!saveResult.success) {
      return {
        success: false,
        error: `Persistence failure: Failed to record Call Next in storage (${saveResult.error}).`,
        code: 'PERSISTENCE_FAILED',
        state // Original state untouched
      };
    }
  }

  return {
    success: true,
    token: transitionResult.token,
    state: transitionResult.state
  };
}

/**
 * Marks the currently serving token as COMPLETED.
 *
 * Rules:
 * - Only the token currently in SERVING status for that service can be completed.
 * - Records completedAt; sets skippedAt = null.
 * - Frees counter for next customer.
 * - Persists state before reporting success.
 *
 * @param {object} params
 * @param {object} params.state - Current queue state
 * @param {string} params.serviceId - Service identifier
 * @param {Storage|object|null} [params.storage] - Storage engine
 * @param {number} [params.timestamp=Date.now()] - Timestamp
 * @returns {{ success: boolean, token?: object, state: object, error?: string, code?: string }}
 */
export function completeServingToken({
  state,
  serviceId,
  storage = null,
  timestamp = Date.now()
}) {
  const { servingToken } = getServiceQueue(state, serviceId);
  if (!servingToken) {
    return {
      success: false,
      error: `No token is currently SERVING at this counter. Only an active serving customer can be completed.`,
      code: 'NOT_SERVING',
      state
    };
  }

  const transitionResult = applyTransition(state, servingToken.id, TOKEN_STATUS.COMPLETED, timestamp);
  if (!transitionResult.success) {
    return {
      success: false,
      error: transitionResult.reason,
      code: 'TRANSITION_REJECTED',
      state
    };
  }

  const targetStorage = storage !== null ? storage : getStorageEngine();
  if (targetStorage) {
    const saveResult = saveQueueState(transitionResult.state, targetStorage);
    if (!saveResult.success) {
      return {
        success: false,
        error: `Persistence failure: Failed to mark token as completed (${saveResult.error}).`,
        code: 'PERSISTENCE_FAILED',
        state
      };
    }
  }

  return {
    success: true,
    token: transitionResult.token,
    state: transitionResult.state
  };
}

/**
 * Marks the currently serving token as SKIPPED (absent customer / no-show).
 *
 * Rules:
 * - Only the token currently in SERVING status for that service can be skipped.
 * - Records skippedAt; sets completedAt = null.
 * - Frees counter for next customer.
 * - Excludes token from Stage B completed duration averages.
 *
 * @param {object} params
 * @param {object} params.state - Current queue state
 * @param {string} params.serviceId - Service identifier
 * @param {Storage|object|null} [params.storage] - Storage engine
 * @param {number} [params.timestamp=Date.now()] - Timestamp
 * @returns {{ success: boolean, token?: object, state: object, error?: string, code?: string }}
 */
export function skipServingToken({
  state,
  serviceId,
  storage = null,
  timestamp = Date.now()
}) {
  const { servingToken } = getServiceQueue(state, serviceId);
  if (!servingToken) {
    return {
      success: false,
      error: `No token is currently SERVING at this counter. Only an active customer can be marked as skipped.`,
      code: 'NOT_SERVING',
      state
    };
  }

  const transitionResult = applyTransition(state, servingToken.id, TOKEN_STATUS.SKIPPED, timestamp);
  if (!transitionResult.success) {
    return {
      success: false,
      error: transitionResult.reason,
      code: 'TRANSITION_REJECTED',
      state
    };
  }

  const targetStorage = storage !== null ? storage : getStorageEngine();
  if (targetStorage) {
    const saveResult = saveQueueState(transitionResult.state, targetStorage);
    if (!saveResult.success) {
      return {
        success: false,
        error: `Persistence failure: Failed to mark token as skipped (${saveResult.error}).`,
        code: 'PERSISTENCE_FAILED',
        state
      };
    }
  }

  return {
    success: true,
    token: transitionResult.token,
    state: transitionResult.state
  };
}

/**
 * Re-queues a SKIPPED token back into the WAITING queue.
 *
 * Rules:
 * - Permitted ONLY for tokens currently in SKIPPED status.
 * - Resets calledAt, completedAt, and skippedAt to null.
 * - Reassigns createdAt to timestamp, appending the token to the TAIL of the line.
 * - Increments requeueCount.
 * - Preserves deterministic FIFO order for existing waiting customers.
 *
 * @param {object} params
 * @param {object} params.state - Current queue state
 * @param {string} params.tokenId - ID of skipped token
 * @param {Storage|object|null} [params.storage] - Storage engine
 * @param {number} [params.timestamp=Date.now()] - Timestamp
 * @returns {{ success: boolean, token?: object, state: object, error?: string, code?: string }}
 */
export function requeueSkippedToken({
  state,
  tokenId,
  storage = null,
  timestamp = Date.now()
}) {
  const token = state.tokens.find((t) => t.id === tokenId);
  if (!token) {
    return {
      success: false,
      error: `Token with ID "${tokenId}" not found.`,
      code: 'TOKEN_NOT_FOUND',
      state
    };
  }

  if (token.status !== TOKEN_STATUS.SKIPPED) {
    return {
      success: false,
      error: `Cannot re-queue token ${token.tokenNumber}: Status is "${token.status}". Only SKIPPED tokens can be re-queued.`,
      code: 'INVALID_STATUS',
      state
    };
  }

  const transitionResult = applyTransition(state, tokenId, TOKEN_STATUS.WAITING, timestamp);
  if (!transitionResult.success) {
    return {
      success: false,
      error: transitionResult.reason,
      code: 'TRANSITION_REJECTED',
      state
    };
  }

  const targetStorage = storage !== null ? storage : getStorageEngine();
  if (targetStorage) {
    const saveResult = saveQueueState(transitionResult.state, targetStorage);
    if (!saveResult.success) {
      return {
        success: false,
        error: `Persistence failure: Failed to save re-queued token (${saveResult.error}).`,
        code: 'PERSISTENCE_FAILED',
        state
      };
    }
  }

  return {
    success: true,
    token: transitionResult.token,
    state: transitionResult.state
  };
}

/**
 * Toggles the intake status of a service counter (ACTIVE <-> PAUSED).
 *
 * Rules:
 * - Prevents new token issuance while PAUSED.
 * - Preserves existing waiting tokens in their current order.
 * - Resuming allows issuance again.
 *
 * @param {object} params
 * @param {object} params.state - Current queue state
 * @param {string} params.serviceId - Service identifier
 * @param {Storage|object|null} [params.storage] - Storage engine
 * @returns {{ success: boolean, serviceId: string, newStatus: string, state: object, error?: string }}
 */
export function toggleServicePause({
  state,
  serviceId,
  storage = null
}) {
  const service = APPROVED_SERVICES.find((s) => s.id === serviceId);
  if (!service) {
    return {
      success: false,
      error: `Invalid service ID: "${serviceId}".`,
      state
    };
  }

  const currentStatus = state.serviceStatuses?.[serviceId] || SERVICE_STATUS.ACTIVE;
  const newStatus = currentStatus === SERVICE_STATUS.ACTIVE ? SERVICE_STATUS.PAUSED : SERVICE_STATUS.ACTIVE;

  const nextState = setServiceStatus(state, serviceId, newStatus);

  const targetStorage = storage !== null ? storage : getStorageEngine();
  if (targetStorage) {
    const saveResult = saveQueueState(nextState, targetStorage);
    if (!saveResult.success) {
      return {
        success: false,
        error: `Persistence failure: Could not update service pause status (${saveResult.error}).`,
        state
      };
    }
  }

  return {
    success: true,
    serviceId,
    newStatus,
    state: nextState
  };
}

/**
 * Resets a single service's queue and sequence counter back to 0.
 *
 * Rules:
 * - Clears all tokens belonging to this specific serviceId.
 * - Resets sequence counter for this service to 0 (next token: 001).
 * - Leaves other services completely unaffected.
 *
 * @param {object} params
 * @param {object} params.state - Current queue state
 * @param {string} params.serviceId - Service identifier
 * @param {Storage|object|null} [params.storage] - Storage engine
 * @param {number} [params.timestamp=Date.now()] - Timestamp
 * @returns {{ success: boolean, serviceId: string, state: object, error?: string }}
 */
export function resetServiceQueue({
  state,
  serviceId,
  storage = null,
  timestamp = Date.now()
}) {
  const service = APPROVED_SERVICES.find((s) => s.id === serviceId);
  if (!service) {
    return {
      success: false,
      error: `Invalid service ID: "${serviceId}".`,
      state
    };
  }

  const remainingTokens = state.tokens.filter((t) => t.serviceId !== serviceId);
  const nextState = {
    ...state,
    version: (state.version || 1) + 1,
    lastUpdatedAt: timestamp,
    sequenceCounters: {
      ...state.sequenceCounters,
      [serviceId]: 0
    },
    serviceStatuses: {
      ...state.serviceStatuses,
      [serviceId]: SERVICE_STATUS.ACTIVE
    },
    tokens: remainingTokens
  };

  const targetStorage = storage !== null ? storage : getStorageEngine();
  if (targetStorage) {
    const saveResult = saveQueueState(nextState, targetStorage);
    if (!saveResult.success) {
      return {
        success: false,
        error: `Persistence failure: Could not reset service queue (${saveResult.error}).`,
        state
      };
    }
    // Clean up session token if it belonged to the reset service
    try {
      const currentSessionTokenId = getSessionTokenId(targetStorage);
      if (currentSessionTokenId) {
        const wasInResetService = state.tokens.some(
          (t) => t.id === currentSessionTokenId && t.serviceId === serviceId
        );
        if (wasInResetService) {
          clearSessionTokenId(targetStorage);
        }
      }
    } catch (_) {}
  }

  return {
    success: true,
    serviceId,
    state: nextState
  };
}

/**
 * Resets all counters, clearing all tokens and resetting all sequences to 000.
 *
 * Rules:
 * - Advances state version monotonically: version = (state.version || 1) + 1.
 * - Empties tokens array.
 * - Resets all sequence counters to 0 (next tokens will start at 001).
 * - Resets all service statuses to ACTIVE.
 * - Requires persistence to succeed before reporting success.
 *
 * @param {object} [params]
 * @param {object|null} [params.state] - Current state (used for monotonic version advance)
 * @param {Storage|object|null} [params.storage] - Storage engine
 * @param {number} [params.timestamp=Date.now()] - Timestamp
 * @returns {{ success: boolean, state: object, error?: string, code?: string }}
 */
export function resetAllQueuesAction({
  state = null,
  storage = null,
  timestamp = Date.now()
} = {}) {
  const currentVersion = state?.version || 1;
  const nextVersion = currentVersion + 1;

  const freshState = {
    ...createInitialState(),
    version: nextVersion,
    lastUpdatedAt: timestamp
  };

  const targetStorage = storage !== null ? storage : getStorageEngine();

  if (targetStorage) {
    const saveResult = saveQueueState(freshState, targetStorage);
    if (!saveResult.success) {
      return {
        success: false,
        error: `Persistence failure: Could not save master reset state (${saveResult.error}).`,
        code: 'PERSISTENCE_FAILED',
        state: state || createInitialState()
      };
    }
    clearSessionTokenId(targetStorage);
  }

  return {
    success: true,
    state: freshState
  };
}
