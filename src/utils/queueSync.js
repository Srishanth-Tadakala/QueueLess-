/**
 * QueueLess Cross-Tab Synchronization Module
 * Source of truth: docs/requirements.md (Version 1.2.0, Section 4.2)
 *
 * Responsibilities:
 * 1. BroadcastChannel-based notifications on state mutation across same-origin tabs.
 * 2. Fallback to Window 'storage', 'focus', and Document 'visibilitychange' events.
 * 3. Prevention of self-echo loops via originId / senderId filtering.
 * 4. Lightweight event metadata without leaking customer PII or raw token dumps.
 * 5. Clean teardown and disposal of browser channels and listeners.
 *
 * CRITICAL ARCHITECTURAL CONCURRENCY LIMITATION:
 * In a client-side prototype utilizing browser localStorage and BroadcastChannel,
 * neither primitive provides distributed locking, atomic Compare-And-Swap (CAS),
 * or transactional guarantees across concurrent threads. If two tabs attempt to mutate
 * state at the identical millisecond, the final write will overwrite the earlier write
 * (last-write-wins). This implementation provides best-effort eventual consistency,
 * defensive precondition validation, and monotonic version comparison.
 */

import { QUEUELESS_STORAGE_KEY } from './storage.js';

export const SYNC_CHANNEL_NAME = 'queueless_queue_sync_v1';

/**
 * Approved cross-tab synchronization mutation events.
 */
export const SYNC_EVENTS = Object.freeze({
  TOKEN_ISSUED: 'TOKEN_ISSUED',
  TOKEN_CANCELLED: 'TOKEN_CANCELLED',
  TOKEN_CALLED: 'TOKEN_CALLED',
  TOKEN_COMPLETED: 'TOKEN_COMPLETED',
  TOKEN_SKIPPED: 'TOKEN_SKIPPED',
  TOKEN_REQUEUED: 'TOKEN_REQUEUED',
  SERVICE_PAUSED: 'SERVICE_PAUSED',
  SERVICE_RESUMED: 'SERVICE_RESUMED',
  SERVICE_RESET: 'SERVICE_RESET',
  ALL_QUEUES_RESET: 'ALL_QUEUES_RESET',

  // Supporting signaling events
  QUEUE_UPDATED: 'QUEUE_UPDATED',
  STORAGE_FALLBACK: 'STORAGE_FALLBACK',
  FOCUS_REFRESH: 'FOCUS_REFRESH',
  VISIBILITY_REFRESH: 'VISIBILITY_REFRESH',

  // Aliases for backward compatibility
  CALL_NEXT: 'TOKEN_CALLED',
  PAUSE_TOGGLED: 'SERVICE_PAUSED',
  RESET_ALL: 'ALL_QUEUES_RESET'
});

export const SYNC_MESSAGE_TYPE = SYNC_EVENTS;

/**
 * Checks whether the browser environment supports the native BroadcastChannel API.
 *
 * @returns {boolean}
 */
export function hasBroadcastChannel() {
  return typeof window !== 'undefined' && typeof window.BroadcastChannel === 'function';
}

/**
 * Creates a BroadcastChannel instance for QueueLess cross-tab synchronization.
 * Returns null if BroadcastChannel is unsupported.
 *
 * @param {string} [channelName=SYNC_CHANNEL_NAME]
 * @returns {BroadcastChannel|null}
 */
export function createSyncChannel(channelName = SYNC_CHANNEL_NAME) {
  if (hasBroadcastChannel()) {
    try {
      return new window.BroadcastChannel(channelName);
    } catch (err) {
      console.warn('[QueueLess Sync] BroadcastChannel initialization failed:', err.message);
      return null;
    }
  }
  return null;
}

/**
 * Generates a unique client origin/sender ID for filtering out self-echo messages.
 *
 * @returns {string}
 */
export function generateOriginId() {
  const rand = Math.random().toString(36).substring(2, 9);
  const time = Date.now().toString(36);
  return `tab_${time}_${rand}`;
}

export const generateSenderId = generateOriginId;

/**
 * Broadcasts a state change notification to other same-origin tabs.
 *
 * Rules:
 * - Must ONLY be called after state has been successfully persisted.
 * - Never broadcasts candidate state that failed to save.
 * - Transmits minimal metadata (type, version, timestamp, originId, serviceId).
 * - Never transmits customer names, contact info, or full token dumps (PII invariant).
 * - Gracefully catches errors without throwing.
 *
 * @param {object} params
 * @param {string} params.type - One of SYNC_EVENTS
 * @param {number} params.version - The newly persisted state version
 * @param {string} [params.originId] - Unique origin identifier of the mutating tab
 * @param {string} [params.senderId] - Alias for originId
 * @param {object} [params.metadata] - Optional non-PII metadata (e.g. { serviceId })
 * @param {BroadcastChannel|null} [params.channel] - Active BroadcastChannel instance
 * @returns {{ success: boolean, payload?: object, error?: string, fallback?: string }}
 */
export function broadcastSyncEvent({
  type = SYNC_EVENTS.QUEUE_UPDATED,
  version = 1,
  originId = null,
  senderId = null,
  metadata = {},
  channel = null
}) {
  const resolvedOriginId = originId || senderId || 'anonymous_tab';

  const payload = {
    type,
    version: typeof version === 'number' ? version : 1,
    timestamp: Date.now(),
    originId: resolvedOriginId,
    senderId: resolvedOriginId, // alias for backwards compatibility
    serviceId: metadata?.serviceId || null
  };

  // If an active BroadcastChannel instance was passed, use it directly
  if (channel && typeof channel.postMessage === 'function') {
    try {
      channel.postMessage(payload);
      return { success: true, payload };
    } catch (err) {
      console.warn('[QueueLess Sync] Failed to post message to provided BroadcastChannel:', err.message);
      return { success: false, error: err.message, payload };
    }
  }

  // Fall back to creating a short-lived BroadcastChannel instance if supported
  if (hasBroadcastChannel()) {
    let tempChannel = null;
    try {
      tempChannel = new window.BroadcastChannel(SYNC_CHANNEL_NAME);
      tempChannel.postMessage(payload);
      tempChannel.close();
      return { success: true, payload };
    } catch (err) {
      if (tempChannel) {
        try { tempChannel.close(); } catch (_) {}
      }
      console.warn('[QueueLess Sync] BroadcastChannel postMessage failed:', err.message);
      return { success: false, error: err.message, payload };
    }
  }

  // BroadcastChannel unavailable: other tabs will detect the update via storage event fallback
  return {
    success: true,
    payload,
    fallback: 'storage_event_used'
  };
}

/**
 * Subscribes to cross-tab queue state change notifications.
 *
 * Features:
 * - Primary: Native BroadcastChannel listener.
 * - Fallbacks:
 *   1. Window 'storage' event listener (cross-tab mutations).
 *   2. Window 'focus' event listener (regained window focus).
 *   3. Document 'visibilitychange' event listener (tab returned to visible).
 * - Filters out self-echo notifications using originId.
 * - Returns an unsubscribe/cleanup function that closes channels and removes all event listeners.
 *
 * @param {object} params
 * @param {string} [params.originId] - Unique origin ID of the subscribing tab/hook
 * @param {string} [params.senderId] - Alias for originId
 * @param {function} params.onSyncEvent - Callback invoked when an external state update is detected: (event) => void
 * @param {BroadcastChannel|null} [params.customBroadcastChannel] - Injected BroadcastChannel (for testing)
 * @param {Window|object|null} [params.customWindow] - Injected Window / event target (for testing)
 * @param {Document|object|null} [params.customDocument] - Injected Document / event target (for testing)
 * @returns {() => void} Teardown function
 */
export function subscribeCrossTabSync({
  originId = null,
  senderId = null,
  onSyncEvent,
  customBroadcastChannel = null,
  customWindow = null,
  customDocument = null
}) {
  if (typeof onSyncEvent !== 'function') {
    return () => {};
  }

  const localOriginId = originId || senderId || 'anonymous_tab';

  const activeChannel = customBroadcastChannel !== null
    ? customBroadcastChannel
    : createSyncChannel(SYNC_CHANNEL_NAME);

  const targetWindow = customWindow !== null
    ? customWindow
    : (typeof window !== 'undefined' ? window : null);

  const targetDocument = customDocument !== null
    ? customDocument
    : (typeof document !== 'undefined' ? document : null);

  // 1. BroadcastChannel message handler
  if (activeChannel) {
    activeChannel.onmessage = (event) => {
      const data = event?.data;
      if (!data || typeof data !== 'object') return;

      // Filter out self-echo messages
      const sender = data.originId || data.senderId;
      if (sender && sender === localOriginId) {
        return;
      }

      onSyncEvent({
        type: data.type || SYNC_EVENTS.QUEUE_UPDATED,
        version: typeof data.version === 'number' ? data.version : null,
        timestamp: data.timestamp || Date.now(),
        originId: sender || 'external_tab',
        senderId: sender || 'external_tab',
        serviceId: data.serviceId || null,
        channel: 'broadcast_channel'
      });
    };
  }

  // 2. Fallbacks: storage event, focus event, visibilitychange event
  let storageHandler = null;
  let focusHandler = null;
  let visibilityHandler = null;

  if (targetWindow && typeof targetWindow.addEventListener === 'function') {
    storageHandler = (event) => {
      // Filter for QueueLess storage key only
      if (event.key !== QUEUELESS_STORAGE_KEY) {
        return;
      }

      // Avoid unnecessary triggers if value was removed or empty
      if (event.newValue === null || event.newValue === undefined) {
        return;
      }

      onSyncEvent({
        type: SYNC_EVENTS.STORAGE_FALLBACK,
        version: null, // Will be loaded from canonical storage
        timestamp: Date.now(),
        originId: 'storage_event',
        senderId: 'storage_event',
        channel: 'storage_event'
      });
    };

    focusHandler = () => {
      onSyncEvent({
        type: SYNC_EVENTS.FOCUS_REFRESH,
        version: null,
        timestamp: Date.now(),
        originId: 'focus_refresh',
        senderId: 'focus_refresh',
        channel: 'focus'
      });
    };

    targetWindow.addEventListener('storage', storageHandler);
    targetWindow.addEventListener('focus', focusHandler);
  }

  if (targetDocument && typeof targetDocument.addEventListener === 'function') {
    visibilityHandler = () => {
      if (targetDocument.visibilityState === 'visible') {
        onSyncEvent({
          type: SYNC_EVENTS.VISIBILITY_REFRESH,
          version: null,
          timestamp: Date.now(),
          originId: 'visibility_change',
          senderId: 'visibility_change',
          channel: 'visibilitychange'
        });
      }
    };

    targetDocument.addEventListener('visibilitychange', visibilityHandler);
  }

  // 3. Teardown / Cleanup
  return () => {
    if (activeChannel) {
      try {
        activeChannel.onmessage = null;
        if (typeof activeChannel.close === 'function') {
          activeChannel.close();
        }
      } catch (err) {
        console.warn('[QueueLess Sync] Error during channel close:', err.message);
      }
    }

    if (targetWindow && typeof targetWindow.removeEventListener === 'function') {
      if (storageHandler) {
        targetWindow.removeEventListener('storage', storageHandler);
      }
      if (focusHandler) {
        targetWindow.removeEventListener('focus', focusHandler);
      }
    }

    if (targetDocument && typeof targetDocument.removeEventListener === 'function') {
      if (visibilityHandler) {
        targetDocument.removeEventListener('visibilitychange', visibilityHandler);
      }
    }
  };
}

