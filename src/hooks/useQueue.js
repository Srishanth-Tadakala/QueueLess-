import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createInitialState } from '../utils/queueModel.js';
import { loadQueueState, getStorageEngine } from '../utils/storage.js';
import {
  getSessionTokenId,
  getActiveSessionToken,
  issueCustomerToken,
  cancelCustomerToken,
  clearSessionTokenId
} from '../utils/tokenIssuance.js';
import { getQueueMetrics, getAllServicesAnalytics } from '../utils/estimationEngine.js';
import {
  callNextToken,
  completeServingToken,
  skipServingToken,
  requeueSkippedToken,
  toggleServicePause,
  resetServiceQueue,
  resetAllQueuesAction
} from '../utils/adminDispatch.js';
import {
  createSyncChannel,
  broadcastSyncEvent,
  subscribeCrossTabSync,
  generateOriginId,
  hasBroadcastChannel,
  SYNC_EVENTS,
  SYNC_CHANNEL_NAME
} from '../utils/queueSync.js';

/**
 * Custom React Hook: useQueue
 * Manages queue state, active customer session, token issuance,
 * queue position, Stage A baseline wait estimation, Admin dispatcher controls,
 * and Best-Effort Cross-Tab Synchronization (BroadcastChannel & Storage fallback).
 *
 * Guarantees:
 * - Single source of truth loaded from storage adapter.
 * - Protects against stale closures via state refs.
 * - Enforces one-active-token-per-session rule.
 * - Dynamically computes position and Stage A wait estimates.
 * - Dispatches admin actions with verified persistence before React state update.
 * - Publishes synchronization notifications only after successful persistence.
 * - Reloads canonical state upon receiving cross-tab sync events without echo loops.
 * - Disposes channels and event listeners on hook unmount.
 * - Transparently surfaces storage errors without crashing.
 */
export function useQueue() {
  const [queueState, setQueueState] = useState(createInitialState);
  const [sessionTokenId, setSessionTokenIdState] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [storageNotice, setStorageNotice] = useState(null);
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Ref to prevent stale closures during rapid successive actions
  const stateRef = useRef(queueState);
  stateRef.current = queueState;

  const sessionTokenRef = useRef(sessionTokenId);
  sessionTokenRef.current = sessionTokenId;

  // Stable unique origin ID to filter self-echo cross-tab messages
  const senderIdRef = useRef(generateOriginId());

  // Active BroadcastChannel reference
  const syncChannelRef = useRef(null);

  // Periodic wall-clock tick to update elapsed service times
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 15000); // 15-second tick
    return () => clearInterval(timer);
  }, []);

  // Initial mount load from storage adapter
  useEffect(() => {
    const storage = getStorageEngine();
    const loadResult = loadQueueState(storage);

    setQueueState(loadResult.state);

    if (loadResult.source === 'fallback_malformed') {
      setStorageNotice('Storage notice: Corrupted data was detected and cleanly recovered to an initial state.');
    } else if (loadResult.source === 'fallback_storage_error') {
      setStorageNotice(`Storage restriction: Running in-memory (${loadResult.error || 'Private mode'}). State will not persist across browser restarts.`);
    }

    const currentSessionId = getSessionTokenId(storage);
    setSessionTokenIdState(currentSessionId);
    setIsLoading(false);
  }, []);

  // Phase 5A: Cross-Tab Synchronization Subscription
  useEffect(() => {
    const syncChannel = createSyncChannel(SYNC_CHANNEL_NAME);
    syncChannelRef.current = syncChannel;

    const unsubscribe = subscribeCrossTabSync({
      originId: senderIdRef.current,
      customBroadcastChannel: syncChannel,
      onSyncEvent: (event) => {
        // Read canonical persisted state directly from storage
        const storage = getStorageEngine();
        const loadResult = loadQueueState(storage);

        if (!loadResult || !loadResult.state) {
          return;
        }

        // Defensive guard: never overwrite valid in-memory state with corrupted data
        if (loadResult.source === 'fallback_malformed' || loadResult.source === 'fallback_invalid_schema') {
          console.warn('[QueueLess Sync] Ignoring corrupted external state detected during cross-tab event');
          return;
        }

        const candidateState = loadResult.state;
        const currentState = stateRef.current;

        // Versioning check: Apply update ONLY if incoming persisted state is strictly newer
        if (candidateState.version > (currentState?.version || 0)) {
          setQueueState(candidateState);

          // Session safety check: verify active session token still exists in new state
          const currentSessionId = sessionTokenRef.current;
          if (currentSessionId) {
            const tokenExists = Array.isArray(candidateState.tokens) && candidateState.tokens.some((t) => t.id === currentSessionId);
            if (!tokenExists) {
              // Token was removed (e.g. counter reset) - clear session reference to prevent attaching to new token
              clearSessionTokenId(storage);
              setSessionTokenIdState(null);
            } else {
              const storedSessionId = getSessionTokenId(storage);
              if (storedSessionId !== currentSessionId) {
                setSessionTokenIdState(storedSessionId);
              }
            }
          } else {
            const storedSessionId = getSessionTokenId(storage);
            if (storedSessionId) {
              const tokenExists = Array.isArray(candidateState.tokens) && candidateState.tokens.some((t) => t.id === storedSessionId);
              if (tokenExists) {
                setSessionTokenIdState(storedSessionId);
              } else {
                clearSessionTokenId(storage);
              }
            }
          }
        }
      }
    });

    return () => {
      unsubscribe();
      if (syncChannelRef.current) {
        try {
          syncChannelRef.current.close();
        } catch (_) {}
        syncChannelRef.current = null;
      }
    };
  }, []);

  // Compute active session token (WAITING or SERVING)
  const activeToken = useMemo(() => {
    return getActiveSessionToken(queueState, sessionTokenId);
  }, [queueState, sessionTokenId]);

  // Compute tracked session token (including terminal COMPLETED, SKIPPED, CANCELLED)
  const trackedToken = useMemo(() => {
    if (!sessionTokenId || !queueState?.tokens) return null;
    return queueState.tokens.find((t) => t.id === sessionTokenId) || null;
  }, [queueState, sessionTokenId]);

  // Compute live queue position and Stage B wait metrics for active customer
  const activeMetrics = useMemo(() => {
    if (!activeToken) return null;
    return getQueueMetrics(activeToken, queueState, currentTime);
  }, [activeToken, queueState, currentTime]);

  // Compute Stage B rolling-average duration analytics for all services (derived from existing state)
  const serviceAnalytics = useMemo(() => {
    return getAllServicesAnalytics(queueState);
  }, [queueState]);

  /**
   * Helper to broadcast state changes across tabs after confirmed persistence.
   */
  const notifyMutation = useCallback((type, nextState, metadata = {}) => {
    if (!nextState || typeof nextState.version !== 'number') return;
    broadcastSyncEvent({
      type,
      version: nextState.version,
      originId: senderIdRef.current,
      metadata,
      channel: syncChannelRef.current
    });
  }, []);

  /**
   * Controlled Customer Token Issuance
   *
   * @param {string} serviceId - 'admissions' | 'finance' | 'examinations'
   * @param {string} [customerName] - Optional name
   * @returns {{ success: boolean, token?: object, error?: string }}
   */
  const issueToken = useCallback((serviceId, customerName = '') => {
    const storage = getStorageEngine();
    const currentState = stateRef.current;
    const currentSessionId = sessionTokenRef.current;

    const result = issueCustomerToken({
      state: currentState,
      serviceId,
      customerName,
      sessionTokenId: currentSessionId,
      storage
    });

    if (!result.success) {
      setError(result.error);
      return result;
    }

    // Update React state
    setQueueState(result.state);
    setSessionTokenIdState(result.token.id);
    setError(null);

    // Notify other tabs
    notifyMutation(SYNC_EVENTS.TOKEN_ISSUED, result.state, { serviceId });
    return result;
  }, [notifyMutation]);

  /**
   * Customer Ticket Cancellation
   *
   * @param {string} tokenId - ID of active token
   * @returns {{ success: boolean, error?: string }}
   */
  const cancelToken = useCallback((tokenId) => {
    const storage = getStorageEngine();
    const currentState = stateRef.current;

    const result = cancelCustomerToken({
      state: currentState,
      tokenId,
      storage
    });

    if (!result.success) {
      setError(result.error);
      return result;
    }

    setQueueState(result.state);
    setSessionTokenIdState(null);
    setError(null);

    // Notify other tabs
    notifyMutation(SYNC_EVENTS.TOKEN_CANCELLED, result.state, { serviceId: result.token?.serviceId });
    return result;
  }, [notifyMutation]);

  /**
   * Dismisses session token from view (e.g., customer finished viewing completed ticket)
   */
  const dismissSessionToken = useCallback(() => {
    const storage = getStorageEngine();
    clearSessionTokenId(storage);
    setSessionTokenIdState(null);
  }, []);

  /* ========================================================================
   * Administrator Dispatcher Methods (with Cross-Tab Sync)
   * ======================================================================== */

  /**
   * Dispatches the next eligible WAITING token for a service to SERVING.
   *
   * @param {string} serviceId
   * @returns {{ success: boolean, token?: object, error?: string }}
   */
  const callNext = useCallback((serviceId) => {
    const storage = getStorageEngine();
    const currentState = stateRef.current;

    const result = callNextToken({
      state: currentState,
      serviceId,
      storage
    });

    if (!result.success) {
      setError(result.error);
      return result;
    }

    setQueueState(result.state);
    setError(null);

    notifyMutation(SYNC_EVENTS.TOKEN_CALLED, result.state, { serviceId });
    return result;
  }, [notifyMutation]);

  /**
   * Completes the token currently SERVING at a service counter.
   *
   * @param {string} serviceId
   * @returns {{ success: boolean, token?: object, error?: string }}
   */
  const completeServing = useCallback((serviceId) => {
    const storage = getStorageEngine();
    const currentState = stateRef.current;

    const result = completeServingToken({
      state: currentState,
      serviceId,
      storage
    });

    if (!result.success) {
      setError(result.error);
      return result;
    }

    setQueueState(result.state);
    setError(null);

    notifyMutation(SYNC_EVENTS.TOKEN_COMPLETED, result.state, { serviceId });
    return result;
  }, [notifyMutation]);

  /**
   * Skips the token currently SERVING at a service counter (no-show).
   *
   * @param {string} serviceId
   * @returns {{ success: boolean, token?: object, error?: string }}
   */
  const skipServing = useCallback((serviceId) => {
    const storage = getStorageEngine();
    const currentState = stateRef.current;

    const result = skipServingToken({
      state: currentState,
      serviceId,
      storage
    });

    if (!result.success) {
      setError(result.error);
      return result;
    }

    setQueueState(result.state);
    setError(null);

    notifyMutation(SYNC_EVENTS.TOKEN_SKIPPED, result.state, { serviceId });
    return result;
  }, [notifyMutation]);

  /**
   * Re-queues a SKIPPED token back to the tail of the waiting line.
   *
   * @param {string} tokenId
   * @returns {{ success: boolean, token?: object, error?: string }}
   */
  const requeue = useCallback((tokenId) => {
    const storage = getStorageEngine();
    const currentState = stateRef.current;

    const result = requeueSkippedToken({
      state: currentState,
      tokenId,
      storage
    });

    if (!result.success) {
      setError(result.error);
      return result;
    }

    setQueueState(result.state);
    setError(null);

    notifyMutation(SYNC_EVENTS.TOKEN_REQUEUED, result.state, { serviceId: result.token?.serviceId });
    return result;
  }, [notifyMutation]);

  /**
   * Toggles service intake status (ACTIVE <-> PAUSED).
   *
   * @param {string} serviceId
   * @returns {{ success: boolean, serviceId: string, newStatus: string, error?: string }}
   */
  const togglePause = useCallback((serviceId) => {
    const storage = getStorageEngine();
    const currentState = stateRef.current;

    const result = toggleServicePause({
      state: currentState,
      serviceId,
      storage
    });

    if (!result.success) {
      setError(result.error);
      return result;
    }

    setQueueState(result.state);
    setError(null);

    const eventType = result.newStatus === 'PAUSED'
      ? SYNC_EVENTS.SERVICE_PAUSED
      : SYNC_EVENTS.SERVICE_RESUMED;

    notifyMutation(eventType, result.state, { serviceId });
    return result;
  }, [notifyMutation]);

  /**
   * Resets a single service's sequence counter and removes its tokens.
   *
   * @param {string} serviceId
   * @returns {{ success: boolean, serviceId: string, error?: string }}
   */
  const resetService = useCallback((serviceId) => {
    const storage = getStorageEngine();
    const currentState = stateRef.current;

    const result = resetServiceQueue({
      state: currentState,
      serviceId,
      storage
    });

    if (!result.success) {
      setError(result.error);
      return result;
    }

    setQueueState(result.state);

    // Invalidate local session reference if it belonged to the reset service
    if (sessionTokenRef.current) {
      const wasInResetService = currentState.tokens.some(
        (t) => t.id === sessionTokenRef.current && t.serviceId === serviceId
      );
      if (wasInResetService) {
        setSessionTokenIdState(null);
      }
    }

    setError(null);

    notifyMutation(SYNC_EVENTS.SERVICE_RESET, result.state, { serviceId });
    return result;
  }, [notifyMutation]);

  /**
   * Performs a clean master reset of all service queues and counters.
   *
   * @returns {{ success: boolean }}
   */
  const resetAll = useCallback(() => {
    const storage = getStorageEngine();
    const currentState = stateRef.current;

    const result = resetAllQueuesAction({
      state: currentState,
      storage
    });

    if (!result.success) {
      setError(result.error || 'Master reset failed.');
      return result;
    }

    setQueueState(result.state);
    setSessionTokenIdState(null);
    setError(null);

    notifyMutation(SYNC_EVENTS.ALL_QUEUES_RESET, result.state);
    return result;
  }, [notifyMutation]);

  /**
   * Re-reads latest state from storage (useful for manual refresh)
   */
  const refreshState = useCallback(() => {
    const storage = getStorageEngine();
    const loadResult = loadQueueState(storage);
    setQueueState(loadResult.state);
    const currentSessionId = getSessionTokenId(storage);
    setSessionTokenIdState(currentSessionId);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    queueState,
    activeToken,
    trackedToken,
    activeMetrics,
    serviceAnalytics,
    sessionTokenId,
    isLoading,
    error,
    storageNotice,
    syncStatus: hasBroadcastChannel() ? 'broadcast_channel' : 'storage_fallback',
    syncChannelName: SYNC_CHANNEL_NAME,
    clearError,
    issueToken,
    cancelToken,
    dismissSessionToken,
    callNext,
    completeServing,
    skipServing,
    requeue,
    togglePause,
    resetService,
    resetAll,
    refreshState
  };
}
