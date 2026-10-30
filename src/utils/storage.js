/**
 * QueueLess LocalStorage Persistence Adapter
 * Source of truth: docs/requirements.md (Version 1.2.0)
 *
 * Responsibilities:
 * 1. Load saved queue state with schema validation.
 * 2. Initialize valid empty state when storage is absent.
 * 3. Safely persist state changes with version tracking.
 * 4. Gracefully catch and recover from malformed JSON and storage access blocks (QuotaExceededError / private mode).
 * 5. Provide reload-equivalent snapshot operations and reset semantics.
 */

import { createInitialState, validateQueueState } from './queueModel.js';

export const QUEUELESS_STORAGE_KEY = 'queueless_state_v1';

/**
 * Returns the active storage engine (defaulting to window.localStorage in browser environments).
 * Returns null if window or localStorage is unavailable (e.g., node test environment or strict security sandboxes).
 */
export function getStorageEngine() {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

/**
 * Loads and validates queue state from storage.
 *
 * Resilience & Recovery Rules:
 * - If storage key is empty / absent: returns clean initial state (`source: 'empty'`).
 * - If JSON parsing throws SyntaxError: catches, logs diagnostic warning, and returns clean initial state (`source: 'fallback_malformed'`).
 * - If storage throws on read (private browsing quota/security exception): catches, logs, and returns clean initial state (`source: 'fallback_storage_error'`).
 * - If parsed object fails schema validation: catches invalid fields, logs errors, and returns clean initial state (`source: 'fallback_invalid_schema'`).
 *
 * @param {Storage|object|null} [customStorage] - Optional storage implementation (for unit tests)
 * @returns {{ state: object, source: 'storage'|'empty'|'fallback_malformed'|'fallback_storage_error'|'fallback_invalid_schema', error?: string }}
 */
export function loadQueueState(customStorage = null) {
  const storage = customStorage !== null ? customStorage : getStorageEngine();

  if (!storage) {
    return {
      state: createInitialState(),
      source: 'empty',
      error: 'Storage engine unavailable (running in non-browser or sandboxed environment)'
    };
  }

  let rawData = null;
  try {
    rawData = storage.getItem(QUEUELESS_STORAGE_KEY);
  } catch (err) {
    console.warn('[QueueLess Storage] Failed to read from localStorage:', err.message);
    return {
      state: createInitialState(),
      source: 'fallback_storage_error',
      error: err.message
    };
  }

  if (rawData === null || rawData === undefined || rawData.trim() === '') {
    return {
      state: createInitialState(),
      source: 'empty'
    };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(rawData);
  } catch (err) {
    console.warn('[QueueLess Storage] Malformed JSON detected in storage. Initializing clean recovery state:', err.message);
    return {
      state: createInitialState(),
      source: 'fallback_malformed',
      error: `Malformed JSON: ${err.message}`
    };
  }

  // Validate state against approved SRS schema
  const validation = validateQueueState(parsed);
  if (!validation.isValid) {
    console.warn('[QueueLess Storage] Stored state failed schema validation. Falling back to clean state:', validation.errors);
    return {
      state: createInitialState(),
      source: 'fallback_invalid_schema',
      error: validation.errors.join('; ')
    };
  }

  return {
    state: parsed,
    source: 'storage'
  };
}

/**
 * Persists queue state to storage.
 *
 * Guarantees:
 * - Validates state schema before writing.
 * - Handles QuotaExceededError or security exceptions without throwing or crashing React.
 *
 * @param {object} state - Queue state to save
 * @param {Storage|object|null} [customStorage] - Optional storage implementation
 * @returns {{ success: boolean, error?: string }}
 */
export function saveQueueState(state, customStorage = null) {
  const storage = customStorage !== null ? customStorage : getStorageEngine();

  if (!storage) {
    return {
      success: false,
      error: 'Storage engine unavailable'
    };
  }

  const validation = validateQueueState(state);
  if (!validation.isValid) {
    console.warn('[QueueLess Storage] Attempted to save invalid state:', validation.errors);
    return {
      success: false,
      error: `Validation failed: ${validation.errors.join(', ')}`
    };
  }

  try {
    const serialized = JSON.stringify(state);
    storage.setItem(QUEUELESS_STORAGE_KEY, serialized);
    return { success: true };
  } catch (err) {
    console.warn('[QueueLess Storage] Failed to write state to localStorage:', err.message);
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Clears QueueLess storage key and resets to a fresh initial state.
 *
 * @param {Storage|object|null} [customStorage] - Optional storage implementation
 * @returns {{ success: boolean, state: object }}
 */
export function resetQueueStorage(customStorage = null) {
  const storage = customStorage !== null ? customStorage : getStorageEngine();
  const freshState = createInitialState();

  if (storage) {
    try {
      storage.removeItem(QUEUELESS_STORAGE_KEY);
    } catch (err) {
      console.warn('[QueueLess Storage] Could not remove item from storage:', err.message);
    }
    saveQueueState(freshState, storage);
  }

  return {
    success: true,
    state: freshState
  };
}
