/**
 * QueueLess State Model & Lifecycle Validation Engine
 * Source of truth: docs/requirements.md (Version 1.2.0)
 *
 * Enforces immutable state transitions, approved token statuses,
 * service catalog invariants, and token lifecycle rules.
 */

import { APPROVED_SERVICES, formatTokenNumber } from './services.js';

/**
 * Approved Token Statuses (Section 5.1 & 5.2)
 */
export const TOKEN_STATUS = Object.freeze({
  WAITING: 'WAITING',
  SERVING: 'SERVING',
  COMPLETED: 'COMPLETED',
  SKIPPED: 'SKIPPED',
  CANCELLED: 'CANCELLED'
});

/**
 * Approved Service Desk Statuses (Section 5.4)
 */
export const SERVICE_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED'
});

/**
 * Creates a clean, valid initial queue state.
 *
 * Sequence counters start at 0 so that the very first token generated
 * for any service increments to 1 and formats as '001'.
 *
 * @returns {object} Initial Queue State
 */
export function createInitialState() {
  const initialSequenceCounters = {};
  const initialServiceStatuses = {};

  APPROVED_SERVICES.forEach((service) => {
    initialSequenceCounters[service.id] = 0;
    initialServiceStatuses[service.id] = SERVICE_STATUS.ACTIVE;
  });

  return {
    version: 1,
    lastUpdatedAt: Date.now(),
    sequenceCounters: initialSequenceCounters,
    serviceStatuses: initialServiceStatuses,
    tokens: []
  };
}

/**
 * Validates a queue state object against the approved schema.
 *
 * @param {any} state - State object to validate
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export function validateQueueState(state) {
  const errors = [];

  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { isValid: false, errors: ['State must be a non-null object'] };
  }

  if (typeof state.version !== 'number' || state.version < 1) {
    errors.push('State version must be a positive number');
  }

  if (typeof state.lastUpdatedAt !== 'number') {
    errors.push('State lastUpdatedAt must be a valid timestamp');
  }

  if (!state.sequenceCounters || typeof state.sequenceCounters !== 'object') {
    errors.push('State must contain sequenceCounters object');
  } else {
    APPROVED_SERVICES.forEach((s) => {
      if (typeof state.sequenceCounters[s.id] !== 'number' || state.sequenceCounters[s.id] < 0) {
        errors.push(`Sequence counter for service "${s.id}" must be a non-negative integer`);
      }
    });
  }

  if (!state.serviceStatuses || typeof state.serviceStatuses !== 'object') {
    errors.push('State must contain serviceStatuses object');
  } else {
    APPROVED_SERVICES.forEach((s) => {
      const status = state.serviceStatuses[s.id];
      if (![SERVICE_STATUS.ACTIVE, SERVICE_STATUS.PAUSED].includes(status)) {
        errors.push(`Service status for "${s.id}" must be ACTIVE or PAUSED`);
      }
    });
  }

  if (!Array.isArray(state.tokens)) {
    errors.push('State tokens must be an array');
  } else {
    const validStatuses = Object.values(TOKEN_STATUS);
    state.tokens.forEach((token, index) => {
      if (!token || typeof token !== 'object') {
        errors.push(`Token at index ${index} must be an object`);
        return;
      }
      if (!token.id || typeof token.id !== 'string') {
        errors.push(`Token at index ${index} missing valid id`);
      }
      if (!token.tokenNumber || typeof token.tokenNumber !== 'string') {
        errors.push(`Token at index ${index} missing valid tokenNumber`);
      }
      if (!validStatuses.includes(token.status)) {
        errors.push(`Token ${token.tokenNumber || index} has invalid status "${token.status}"`);
      }
      if (typeof token.createdAt !== 'number') {
        errors.push(`Token ${token.tokenNumber || index} missing numeric createdAt timestamp`);
      }
    });
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Creates and registers a new token for a given service.
 * Respects service pausing and increments independent sequence counter.
 *
 * @param {object} state - Current queue state
 * @param {string} serviceId - Target service identifier ('admissions' | 'finance' | 'examinations')
 * @param {string} [customerName] - Optional customer name
 * @param {number} [timestamp=Date.now()] - Creation timestamp
 * @returns {{ token: object, state: object }}
 */
export function createToken(state, serviceId, customerName = '', timestamp = Date.now()) {
  const service = APPROVED_SERVICES.find((s) => s.id === serviceId);
  if (!service) {
    throw new Error(`Unknown service ID: "${serviceId}". Must be one of approved services.`);
  }

  if (state.serviceStatuses && state.serviceStatuses[serviceId] === SERVICE_STATUS.PAUSED) {
    throw new Error(`Cannot issue token: Service "${service.name}" is currently PAUSED.`);
  }

  // Increment independent sequence counter (starting strictly at 1)
  const currentCounter = state.sequenceCounters?.[serviceId] || 0;
  const nextSequence = currentCounter + 1;
  const tokenNumber = formatTokenNumber(service.prefix, nextSequence);

  const sanitizedCustomerName = typeof customerName === 'string' && customerName.trim().length > 0
    ? customerName.trim().slice(0, 80)
    : undefined;

  const newToken = {
    id: `tok_${timestamp}_${service.prefix.toLowerCase()}${nextSequence}`,
    tokenNumber,
    serviceId: service.id,
    serviceName: service.name,
    customerName: sanitizedCustomerName,
    status: TOKEN_STATUS.WAITING,
    createdAt: timestamp,
    calledAt: null,
    completedAt: null,
    skippedAt: null,
    cancelledAt: null,
    estimatedWaitMinutes: service.baselineDurationMinutes,
    requeueCount: 0
  };

  const nextState = {
    ...state,
    version: (state.version || 1) + 1,
    lastUpdatedAt: timestamp,
    sequenceCounters: {
      ...state.sequenceCounters,
      [serviceId]: nextSequence
    },
    tokens: [...state.tokens, newToken]
  };

  return {
    token: newToken,
    state: nextState
  };
}

/**
 * Checks whether a requested state transition is permitted for a token.
 * Pure validation without side-effects.
 *
 * Allowed FSM Transitions (Section 5.2):
 * - WAITING -> SERVING (Allowed ONLY IF no other token for that service is currently SERVING)
 * - WAITING -> CANCELLED (Customer cancellation)
 * - SERVING -> COMPLETED (Service finished)
 * - SERVING -> SKIPPED (Customer absent)
 * - SKIPPED -> WAITING (Re-queue to tail of line)
 * - Terminal states (COMPLETED, CANCELLED): No transitions permitted.
 *
 * @param {object} token - Target token
 * @param {string} targetStatus - Desired new status
 * @param {object} [context] - Context containing the active state to check counter occupancy
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function canTransition(token, targetStatus, context = {}) {
  if (!token || !token.status) {
    return { allowed: false, reason: 'Invalid or missing token.' };
  }

  const { status: currentStatus, serviceId } = token;

  // 1. Terminal states cannot be transitioned
  if (currentStatus === TOKEN_STATUS.COMPLETED || currentStatus === TOKEN_STATUS.CANCELLED) {
    return {
      allowed: false,
      reason: `Token is in terminal state "${currentStatus}" and cannot be modified.`
    };
  }

  // 2. No-op check
  if (currentStatus === targetStatus) {
    return { allowed: false, reason: `Token is already in status "${targetStatus}".` };
  }

  // 3. WAITING state transitions
  if (currentStatus === TOKEN_STATUS.WAITING) {
    if (targetStatus === TOKEN_STATUS.CANCELLED) {
      return { allowed: true };
    }

    if (targetStatus === TOKEN_STATUS.SERVING) {
      // Rule: Only one token per service counter can be SERVING at a time
      if (context.state && Array.isArray(context.state.tokens)) {
        const activeServing = context.state.tokens.find(
          (t) => t.serviceId === serviceId && t.status === TOKEN_STATUS.SERVING && t.id !== token.id
        );
        if (activeServing) {
          return {
            allowed: false,
            reason: `Cannot call token: Token ${activeServing.tokenNumber} is currently SERVING at this counter. Complete or skip it first.`
          };
        }
      }
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Invalid transition from WAITING to "${targetStatus}". Tokens cannot bypass the SERVING state.`
    };
  }

  // 4. SERVING state transitions
  if (currentStatus === TOKEN_STATUS.SERVING) {
    if (targetStatus === TOKEN_STATUS.COMPLETED) {
      return { allowed: true };
    }
    if (targetStatus === TOKEN_STATUS.SKIPPED) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Invalid transition from SERVING to "${targetStatus}". Active tokens must be COMPLETED or SKIPPED.`
    };
  }

  // 5. SKIPPED state transitions
  if (currentStatus === TOKEN_STATUS.SKIPPED) {
    if (targetStatus === TOKEN_STATUS.WAITING) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Invalid transition from SKIPPED to "${targetStatus}". Skipped tokens can only be Re-queued to WAITING.`
    };
  }

  return {
    allowed: false,
    reason: `Unsupported transition from "${currentStatus}" to "${targetStatus}".`
  };
}

/**
 * Applies a lifecycle transition to a target token immutably.
 *
 * If transition is rejected, returns { success: false, reason, state: originalState },
 * ensuring the original state object is NOT mutated.
 *
 * If valid, updates timestamps according to Section 5.3:
 * - SERVING: records calledAt
 * - COMPLETED: records completedAt (skippedAt remains null)
 * - SKIPPED: records skippedAt (completedAt remains null)
 * - WAITING (from SKIPPED): resets calledAt/completedAt/skippedAt, re-assigns createdAt
 *   to timestamp (appending to tail of line for queue fairness), increments requeueCount.
 *
 * @param {object} state - Current queue state
 * @param {string} tokenId - ID of token to transition
 * @param {string} targetStatus - Desired target status
 * @param {number} [timestamp=Date.now()] - Event timestamp
 * @returns {{ success: boolean, state: object, token?: object, reason?: string }}
 */
export function applyTransition(state, tokenId, targetStatus, timestamp = Date.now()) {
  const tokenIndex = state.tokens.findIndex((t) => t.id === tokenId);
  if (tokenIndex === -1) {
    return {
      success: false,
      reason: `Token with ID "${tokenId}" not found.`,
      state
    };
  }

  const token = state.tokens[tokenIndex];
  const check = canTransition(token, targetStatus, { state });
  if (!check.allowed) {
    return {
      success: false,
      reason: check.reason,
      state // Return untouched original state (immutable guarantee)
    };
  }

  // Construct updated token based on target lifecycle semantics
  const updatedToken = { ...token, status: targetStatus };

  if (targetStatus === TOKEN_STATUS.SERVING) {
    updatedToken.calledAt = timestamp;
  } else if (targetStatus === TOKEN_STATUS.COMPLETED) {
    updatedToken.completedAt = timestamp;
    updatedToken.skippedAt = null;
  } else if (targetStatus === TOKEN_STATUS.SKIPPED) {
    updatedToken.skippedAt = timestamp;
    updatedToken.completedAt = null;
  } else if (targetStatus === TOKEN_STATUS.CANCELLED) {
    updatedToken.cancelledAt = timestamp;
    updatedToken.completedAt = null;
    updatedToken.skippedAt = null;
  } else if (targetStatus === TOKEN_STATUS.WAITING && token.status === TOKEN_STATUS.SKIPPED) {
    // Re-queue semantics: append to tail by reassigning createdAt, reset timestamps
    updatedToken.calledAt = null;
    updatedToken.completedAt = null;
    updatedToken.skippedAt = null;
    updatedToken.createdAt = timestamp;
    updatedToken.requeueCount = (token.requeueCount || 0) + 1;
  }

  const nextTokens = [...state.tokens];
  nextTokens[tokenIndex] = updatedToken;

  const nextState = {
    ...state,
    version: (state.version || 1) + 1,
    lastUpdatedAt: timestamp,
    tokens: nextTokens
  };

  return {
    success: true,
    token: updatedToken,
    state: nextState
  };
}

/**
 * Toggles or updates service desk intake status (ACTIVE or PAUSED).
 *
 * @param {object} state - Current state
 * @param {string} serviceId - Service ID
 * @param {string} status - SERVICE_STATUS.ACTIVE or SERVICE_STATUS.PAUSED
 * @returns {object} Next state
 */
export function setServiceStatus(state, serviceId, status) {
  if (!APPROVED_SERVICES.some((s) => s.id === serviceId)) {
    throw new Error(`Unknown service ID "${serviceId}".`);
  }
  if (![SERVICE_STATUS.ACTIVE, SERVICE_STATUS.PAUSED].includes(status)) {
    throw new Error(`Invalid service status "${status}".`);
  }

  return {
    ...state,
    version: (state.version || 1) + 1,
    lastUpdatedAt: Date.now(),
    serviceStatuses: {
      ...state.serviceStatuses,
      [serviceId]: status
    }
  };
}

/**
 * Resets queue state to pristine initial state (Section 5, DEC-01).
 * All sequence counters reset to 0 so the next issued token is again '001'.
 *
 * @returns {object} Fresh initial queue state
 */
export function resetQueueState() {
  return createInitialState();
}
