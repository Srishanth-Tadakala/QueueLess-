/**
 * QueueLess Customer Token Issuance & Active Session Management
 * Source of truth: docs/requirements.md (Version 1.2.0)
 *
 * Enforces:
 * 1. Approved service catalog validation.
 * 2. Paused service restrictions.
 * 3. One-active-token-per-browser-session rule.
 * 4. Independent sequence counters starting at 001.
 * 5. Successful persistence before reporting issuance.
 * 6. Explicit failure reporting without false successes.
 */

import { APPROVED_SERVICES } from './services.js';
import {
  TOKEN_STATUS,
  SERVICE_STATUS,
  createToken,
  applyTransition
} from './queueModel.js';
import {
  getStorageEngine,
  saveQueueState
} from './storage.js';

export const SESSION_TOKEN_KEY = 'queueless_active_token_id_v1';

/**
 * Retrieves the active token ID associated with the current browser session.
 *
 * @param {Storage|object|null} [storage] - Storage engine
 * @returns {string|null}
 */
export function getSessionTokenId(storage = null) {
  const engine = storage !== null ? storage : getStorageEngine();
  if (!engine) return null;
  try {
    return engine.getItem(SESSION_TOKEN_KEY) || null;
  } catch (err) {
    console.warn('[QueueLess Session] Failed to read session token ID:', err.message);
    return null;
  }
}

/**
 * Stores the active token ID for the current browser session.
 *
 * @param {string} tokenId - ID of newly issued token
 * @param {Storage|object|null} [storage] - Storage engine
 * @returns {boolean}
 */
export function setSessionTokenId(tokenId, storage = null) {
  const engine = storage !== null ? storage : getStorageEngine();
  if (!engine) return false;
  try {
    engine.setItem(SESSION_TOKEN_KEY, tokenId);
    return true;
  } catch (err) {
    console.warn('[QueueLess Session] Failed to save session token ID:', err.message);
    return false;
  }
}

/**
 * Clears the active session token reference (e.g. after cancellation or completion).
 *
 * @param {Storage|object|null} [storage] - Storage engine
 */
export function clearSessionTokenId(storage = null) {
  const engine = storage !== null ? storage : getStorageEngine();
  if (!engine) return;
  try {
    engine.removeItem(SESSION_TOKEN_KEY);
  } catch (err) {
    console.warn('[QueueLess Session] Failed to clear session token ID:', err.message);
  }
}

/**
 * Resolves whether the current browser session holds an active token.
 *
 * An active token is defined as a token in WAITING or SERVING status.
 * If the token is COMPLETED, SKIPPED, CANCELLED, or does not exist,
 * the session has no active token and is eligible to join a new queue.
 *
 * @param {object} state - Current queue state
 * @param {string|null} sessionTokenId - Stored session token ID
 * @returns {object|null} The active token object or null
 */
export function getActiveSessionToken(state, sessionTokenId) {
  if (!state || !Array.isArray(state.tokens) || !sessionTokenId) {
    return null;
  }

  const token = state.tokens.find((t) => t.id === sessionTokenId);
  if (!token) {
    return null;
  }

  // Active token rule: WAITING or SERVING
  if (token.status === TOKEN_STATUS.WAITING || token.status === TOKEN_STATUS.SERVING) {
    return token;
  }

  // Token is in terminal / non-waiting state (COMPLETED, SKIPPED, CANCELLED)
  return null;
}

/**
 * Issues a customer token with full validation and persistence verification.
 *
 * Guarantees:
 * 1. Checks service existence in approved catalog.
 * 2. Checks service is not PAUSED.
 * 3. Enforces one-active-token-per-session rule.
 * 4. Increments only the selected service sequence counter.
 * 5. Requires persistence to succeed before reporting success.
 * 6. Returns original state untouched if persistence or validation fails.
 *
 * @param {object} params
 * @param {object} params.state - Current queue state
 * @param {string} params.serviceId - Selected service ID
 * @param {string} [params.customerName] - Optional customer name
 * @param {string|null} [params.sessionTokenId] - Current session token ID
 * @param {Storage|object|null} [params.storage] - Storage implementation
 * @param {number} [params.timestamp=Date.now()] - Timestamp for deterministic testing
 * @returns {{ success: boolean, token?: object, state: object, error?: string, code?: string, activeToken?: object }}
 */
export function issueCustomerToken({
  state,
  serviceId,
  customerName = '',
  sessionTokenId = null,
  storage = null,
  timestamp = Date.now()
}) {
  // 1. Enforce active-token session rule
  const existingActive = getActiveSessionToken(state, sessionTokenId);
  if (existingActive) {
    return {
      success: false,
      error: `You already hold an active token (${existingActive.tokenNumber}) in ${existingActive.status} status for ${existingActive.serviceName}. You cannot request another token until your current service is completed or cancelled.`,
      code: 'ACTIVE_TOKEN_EXISTS',
      activeToken: existingActive,
      state
    };
  }

  // 2. Validate service exists in approved catalog
  const service = APPROVED_SERVICES.find((s) => s.id === serviceId);
  if (!service) {
    return {
      success: false,
      error: `Invalid service identifier: "${serviceId}". Must be one of the approved services.`,
      code: 'INVALID_SERVICE',
      state
    };
  }

  // 3. Verify service is not paused
  if (state.serviceStatuses && state.serviceStatuses[serviceId] === SERVICE_STATUS.PAUSED) {
    return {
      success: false,
      error: `Cannot issue token: Service "${service.name}" is currently PAUSED.`,
      code: 'SERVICE_PAUSED',
      state
    };
  }

  // 4. Generate token and next candidate state using queue model
  let creationResult;
  try {
    creationResult = createToken(state, serviceId, customerName, timestamp);
  } catch (err) {
    return {
      success: false,
      error: err.message,
      code: 'CREATION_ERROR',
      state
    };
  }

  const { token: newToken, state: candidateState } = creationResult;

  // 5. Attempt persistence before declaring success
  const targetStorage = storage !== null ? storage : getStorageEngine();
  if (targetStorage) {
    const saveResult = saveQueueState(candidateState, targetStorage);
    if (!saveResult.success) {
      return {
        success: false,
        error: `Persistence failure: Token could not be saved to browser storage (${saveResult.error}). Please verify browser storage permissions.`,
        code: 'PERSISTENCE_FAILED',
        state // Original state returned untouched!
      };
    }
    // Record session token ID only after verified persistence
    setSessionTokenId(newToken.id, targetStorage);
  }

  return {
    success: true,
    token: newToken,
    state: candidateState
  };
}

/**
 * Cancels a customer's active token and clears their session reference.
 *
 * @param {object} params
 * @param {object} params.state - Current queue state
 * @param {string} params.tokenId - Token ID to cancel
 * @param {Storage|object|null} [params.storage] - Storage implementation
 * @param {number} [params.timestamp=Date.now()] - Timestamp
 * @returns {{ success: boolean, state: object, error?: string }}
 */
export function cancelCustomerToken({
  state,
  tokenId,
  storage = null,
  timestamp = Date.now()
}) {
  const transitionResult = applyTransition(state, tokenId, TOKEN_STATUS.CANCELLED, timestamp);
  if (!transitionResult.success) {
    return {
      success: false,
      error: transitionResult.reason,
      state
    };
  }

  const targetStorage = storage !== null ? storage : getStorageEngine();
  if (targetStorage) {
    const saveResult = saveQueueState(transitionResult.state, targetStorage);
    if (!saveResult.success) {
      return {
        success: false,
        error: `Persistence failure during cancellation: ${saveResult.error}`,
        state
      };
    }
    // Clear session token reference on cancellation
    clearSessionTokenId(targetStorage);
  }

  return {
    success: true,
    token: transitionResult.token,
    state: transitionResult.state
  };
}
