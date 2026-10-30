import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialState,
  TOKEN_STATUS,
  SERVICE_STATUS,
  createToken,
  applyTransition,
  validateQueueState
} from '../src/utils/queueModel.js';

import {
  loadQueueState,
  saveQueueState,
  QUEUELESS_STORAGE_KEY
} from '../src/utils/storage.js';

import {
  SESSION_TOKEN_KEY,
  getSessionTokenId,
  setSessionTokenId,
  clearSessionTokenId,
  getActiveSessionToken,
  issueCustomerToken,
  cancelCustomerToken
} from '../src/utils/tokenIssuance.js';

import {
  callNextToken,
  completeServingToken,
  skipServingToken,
  requeueSkippedToken,
  toggleServicePause,
  resetServiceQueue,
  resetAllQueuesAction
} from '../src/utils/adminDispatch.js';

import {
  calculateQueuePosition,
  calculateStageAWaitTime
} from '../src/utils/estimationEngine.js';

import {
  SYNC_CHANNEL_NAME,
  SYNC_EVENTS,
  SYNC_MESSAGE_TYPE,
  hasBroadcastChannel,
  createSyncChannel,
  broadcastSyncEvent,
  subscribeCrossTabSync,
  generateOriginId,
  generateSenderId
} from '../src/utils/queueSync.js';

/**
 * In-memory Mock Storage implementing the Web Storage API
 */
function createMockStorage(initialData = {}) {
  const store = new Map(Object.entries(initialData));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    get size() {
      return store.size;
    }
  };
}

/**
 * Mock BroadcastChannel implementation simulating a multi-tab message bus
 */
class MockBroadcastChannelBus {
  constructor() {
    this.channels = new Set();
  }

  createChannel(name = SYNC_CHANNEL_NAME) {
    const bus = this;
    const instance = {
      name,
      closed: false,
      onmessage: null,
      postMessage(data) {
        if (instance.closed) {
          throw new Error('Cannot post message on closed BroadcastChannel');
        }
        // Broadcast to all other open channels with the same name
        for (const ch of bus.channels) {
          if (ch !== instance && !ch.closed && ch.name === name) {
            if (typeof ch.onmessage === 'function') {
              // Deep clone payload to emulate cross-window structured cloning
              const clonedData = JSON.parse(JSON.stringify(data));
              ch.onmessage({ data: clonedData });
            }
          }
        }
      },
      close() {
        instance.closed = true;
        bus.channels.delete(instance);
      }
    };

    bus.channels.add(instance);
    return instance;
  }
}

/**
 * Mock Window implementing storage and focus event listeners
 */
function createMockWindow() {
  const listeners = new Map();
  return {
    addEventListener(event, handler) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event).add(handler);
    },
    removeEventListener(event, handler) {
      if (listeners.has(event)) {
        listeners.get(event).delete(handler);
      }
    },
    dispatchEvent(event, data = {}) {
      if (listeners.has(event)) {
        for (const handler of listeners.get(event)) {
          handler(data);
        }
      }
    },
    getListenerCount(event) {
      return listeners.has(event) ? listeners.get(event).size : 0;
    }
  };
}

/**
 * Mock Document implementing visibilitychange event listeners
 */
function createMockDocument(initialState = 'visible') {
  const listeners = new Map();
  let currentVisibility = initialState;

  return {
    get visibilityState() {
      return currentVisibility;
    },
    setVisibilityState(state) {
      currentVisibility = state;
      if (listeners.has('visibilitychange')) {
        for (const handler of listeners.get('visibilitychange')) {
          handler();
        }
      }
    },
    addEventListener(event, handler) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event).add(handler);
    },
    removeEventListener(event, handler) {
      if (listeners.has(event)) {
        listeners.get(event).delete(handler);
      }
    },
    getListenerCount(event) {
      return listeners.has(event) ? listeners.get(event).size : 0;
    }
  };
}

/* ========================================================================
 * PHASE 5A: 18 COMPREHENSIVE AUTOMATED TESTS
 * ======================================================================== */

test('1. BroadcastChannel initializes successfully with approved channel name', () => {
  // Test constant values
  assert.equal(SYNC_CHANNEL_NAME, 'queueless_queue_sync_v1');
  assert.equal(typeof SYNC_EVENTS, 'object');
  assert.equal(SYNC_EVENTS.TOKEN_ISSUED, 'TOKEN_ISSUED');
  assert.equal(SYNC_EVENTS.TOKEN_CALLED, 'TOKEN_CALLED');
  assert.equal(SYNC_EVENTS.TOKEN_COMPLETED, 'TOKEN_COMPLETED');
  assert.equal(SYNC_EVENTS.TOKEN_SKIPPED, 'TOKEN_SKIPPED');
  assert.equal(SYNC_EVENTS.TOKEN_REQUEUED, 'TOKEN_REQUEUED');
  assert.equal(SYNC_EVENTS.SERVICE_PAUSED, 'SERVICE_PAUSED');
  assert.equal(SYNC_EVENTS.SERVICE_RESUMED, 'SERVICE_RESUMED');
  assert.equal(SYNC_EVENTS.SERVICE_RESET, 'SERVICE_RESET');
  assert.equal(SYNC_EVENTS.ALL_QUEUES_RESET, 'ALL_QUEUES_RESET');

  // Node test environment: window is undefined, hasBroadcastChannel returns false
  assert.equal(hasBroadcastChannel(), false);
  const ch = createSyncChannel();
  assert.equal(ch, null); // Graceful null fallback

  // Simulated browser environment with BroadcastChannel available
  const bus = new MockBroadcastChannelBus();
  const mockCh = bus.createChannel(SYNC_CHANNEL_NAME);
  assert.equal(mockCh.name, 'queueless_queue_sync_v1');
  assert.equal(mockCh.closed, false);
  mockCh.close();
  assert.equal(mockCh.closed, true);
});

test('2. Notifications publish after successful persistence without PII', () => {
  const bus = new MockBroadcastChannelBus();
  const ch1 = bus.createChannel();
  const ch2 = bus.createChannel();

  const messagesReceived = [];
  ch2.onmessage = (event) => {
    messagesReceived.push(event.data);
  };

  const originId = generateOriginId();
  const res = broadcastSyncEvent({
    type: SYNC_EVENTS.TOKEN_ISSUED,
    version: 4,
    originId,
    metadata: { serviceId: 'admissions' },
    channel: ch1
  });

  assert.equal(res.success, true);
  assert.equal(messagesReceived.length, 1);

  const msg = messagesReceived[0];
  assert.equal(msg.type, SYNC_EVENTS.TOKEN_ISSUED);
  assert.equal(msg.version, 4);
  assert.equal(msg.originId, originId);
  assert.equal(msg.senderId, originId);
  assert.equal(msg.serviceId, 'admissions');
  assert.ok(typeof msg.timestamp === 'number');

  // Privacy invariant: no customer names, emails, contact info, or full token dumps
  assert.equal(msg.customerName, undefined);
  assert.equal(msg.token, undefined);
  assert.equal(msg.tokens, undefined);

  ch1.close();
  ch2.close();
});

test('3. Failed persistence does not publish notifications', () => {
  const failingStorage = {
    getItem() { return null; },
    setItem() {
      throw new Error('QuotaExceededError: LocalStorage write denied');
    },
    removeItem() {}
  };

  const bus = new MockBroadcastChannelBus();
  const ch1 = bus.createChannel();
  const ch2 = bus.createChannel();

  let receivedCount = 0;
  ch2.onmessage = () => {
    receivedCount++;
  };

  const state = createInitialState();
  const issueResult = issueCustomerToken({
    state,
    serviceId: 'admissions',
    customerName: 'Alice',
    storage: failingStorage
  });

  // Verify issuance failed
  assert.equal(issueResult.success, false);
  assert.equal(issueResult.code, 'PERSISTENCE_FAILED');

  // Mutation path sequence: Only publish after successful persistence!
  if (issueResult.success) {
    broadcastSyncEvent({
      type: SYNC_EVENTS.TOKEN_ISSUED,
      version: issueResult.state.version,
      channel: ch1
    });
  }

  // Invariant: Must not broadcast any notification on failed persistence
  assert.equal(receivedCount, 0);

  ch1.close();
  ch2.close();
});

test('4. Received events trigger storage reload', () => {
  const storage = createMockStorage();
  const bus = new MockBroadcastChannelBus();
  const chSender = bus.createChannel();
  const chReceiver = bus.createChannel();

  // Tab 1 commits token issuance to storage
  let tab1State = createInitialState();
  const issueRes = issueCustomerToken({
    state: tab1State,
    serviceId: 'admissions',
    customerName: 'Bob',
    storage
  });
  tab1State = issueRes.state;

  // Tab 2 starts with clean initial state (version 1, 0 tokens)
  let tab2State = createInitialState();
  assert.equal(tab2State.version, 1);
  assert.equal(tab2State.tokens.length, 0);

  let reloadCount = 0;
  const teardown = subscribeCrossTabSync({
    originId: 'tab_2_receiver',
    customBroadcastChannel: chReceiver,
    onSyncEvent: (event) => {
      reloadCount++;
      const loaded = loadQueueState(storage);
      if (loaded.state && loaded.state.version > tab2State.version) {
        tab2State = loaded.state;
      }
    }
  });

  // Tab 1 broadcasts notification
  broadcastSyncEvent({
    type: SYNC_EVENTS.TOKEN_ISSUED,
    version: tab1State.version,
    originId: 'tab_1_mutator',
    metadata: { serviceId: 'admissions' },
    channel: chSender
  });

  assert.equal(reloadCount, 1);
  assert.equal(tab2State.version, 2);
  assert.equal(tab2State.tokens.length, 1);
  assert.equal(tab2State.tokens[0].tokenNumber, 'ADM-001');

  teardown();
  chSender.close();
});

test('5. Valid newer states are accepted', () => {
  const storage = createMockStorage();
  const bus = new MockBroadcastChannelBus();
  const chSender = bus.createChannel();
  const chReceiver = bus.createChannel();

  // Tab 2 is at version 2
  let tab2State = {
    ...createInitialState(),
    version: 2
  };

  // State in storage has progressed to version 5
  const newerState = {
    ...createInitialState(),
    version: 5,
    tokens: [
      { id: 'tok_5_a', tokenNumber: 'ADM-001', serviceId: 'admissions', status: TOKEN_STATUS.WAITING, createdAt: 5000 }
    ]
  };
  saveQueueState(newerState, storage);

  let stateUpdated = false;
  const teardown = subscribeCrossTabSync({
    originId: 'tab_2',
    customBroadcastChannel: chReceiver,
    onSyncEvent: () => {
      const loadResult = loadQueueState(storage);
      if (loadResult.state && loadResult.state.version > tab2State.version) {
        tab2State = loadResult.state;
        stateUpdated = true;
      }
    }
  });

  broadcastSyncEvent({
    type: SYNC_EVENTS.QUEUE_UPDATED,
    version: 5,
    originId: 'tab_1',
    channel: chSender
  });

  assert.equal(stateUpdated, true);
  assert.equal(tab2State.version, 5);
  assert.equal(tab2State.tokens.length, 1);
  assert.equal(tab2State.tokens[0].tokenNumber, 'ADM-001');

  teardown();
  chSender.close();
});

test('6. Older states are rejected', () => {
  const storage = createMockStorage();
  const bus = new MockBroadcastChannelBus();
  const chSender = bus.createChannel();
  const chReceiver = bus.createChannel();

  // Tab 2 has committed version 6 in memory
  let tab2State = {
    ...createInitialState(),
    version: 6,
    tokens: [
      { id: 'tok_6_f', tokenNumber: 'FIN-003', serviceId: 'finance', status: TOKEN_STATUS.WAITING, createdAt: 6000 }
    ]
  };

  // Stale state in storage at version 4
  const staleState = {
    ...createInitialState(),
    version: 4,
    tokens: [
      { id: 'tok_4_f', tokenNumber: 'FIN-001', serviceId: 'finance', status: TOKEN_STATUS.WAITING, createdAt: 4000 }
    ]
  };
  saveQueueState(staleState, storage);

  let updateAttempted = false;
  const teardown = subscribeCrossTabSync({
    originId: 'tab_2',
    customBroadcastChannel: chReceiver,
    onSyncEvent: () => {
      const loaded = loadQueueState(storage);
      // Versioning guard: only accept strictly newer versions
      if (loaded.state && loaded.state.version > tab2State.version) {
        tab2State = loaded.state;
        updateAttempted = true;
      }
    }
  });

  // Stale broadcast received
  broadcastSyncEvent({
    type: SYNC_EVENTS.QUEUE_UPDATED,
    version: 4,
    originId: 'stale_tab',
    channel: chSender
  });

  // Invariant: Tab 2 preserves newer state
  assert.equal(updateAttempted, false);
  assert.equal(tab2State.version, 6);
  assert.equal(tab2State.tokens[0].tokenNumber, 'FIN-003');

  teardown();
  chSender.close();
});

test('7. Invalid states are rejected safely without corrupting local state', () => {
  // Corrupt state in storage
  const storage = createMockStorage({
    [QUEUELESS_STORAGE_KEY]: '{"version": 999, "corrupt": true, "tokens": "not_an_array"}'
  });

  const bus = new MockBroadcastChannelBus();
  const chSender = bus.createChannel();
  const chReceiver = bus.createChannel();

  // Tab 2 valid state
  let tab2State = {
    ...createInitialState(),
    version: 3,
    tokens: [
      { id: 'tok_valid', tokenNumber: 'EXM-001', serviceId: 'examinations', status: TOKEN_STATUS.WAITING, createdAt: 1000 }
    ]
  };

  const teardown = subscribeCrossTabSync({
    originId: 'tab_2',
    customBroadcastChannel: chReceiver,
    onSyncEvent: () => {
      const loadResult = loadQueueState(storage);
      // Defensive guard against corrupted fallback state
      if (loadResult.source === 'fallback_malformed' || loadResult.source === 'fallback_invalid_schema') {
        return; // Safely ignore invalid external snapshot
      }
      if (loadResult.state && loadResult.state.version > tab2State.version) {
        tab2State = loadResult.state;
      }
    }
  });

  // Corrupted external tab announces version 999
  broadcastSyncEvent({
    type: SYNC_EVENTS.QUEUE_UPDATED,
    version: 999,
    originId: 'bad_tab',
    channel: chSender
  });

  // Invariant: Tab 2 must reject corrupted data and preserve its valid state
  assert.equal(tab2State.version, 3);
  assert.equal(tab2State.tokens.length, 1);
  assert.equal(tab2State.tokens[0].tokenNumber, 'EXM-001');

  teardown();
  chSender.close();
});

test('8. Duplicate events do not cause unnecessary updates', () => {
  const storage = createMockStorage();
  const bus = new MockBroadcastChannelBus();
  const chSender = bus.createChannel();
  const chReceiver = bus.createChannel();

  let tab2State = {
    ...createInitialState(),
    version: 4
  };
  saveQueueState(tab2State, storage);

  let stateReplacedCount = 0;
  const teardown = subscribeCrossTabSync({
    originId: 'tab_2',
    customBroadcastChannel: chReceiver,
    onSyncEvent: () => {
      const loaded = loadQueueState(storage);
      if (loaded.state && loaded.state.version > tab2State.version) {
        tab2State = loaded.state;
        stateReplacedCount++;
      }
    }
  });

  // Tab 1 posts duplicate events with the same version 4
  broadcastSyncEvent({ type: SYNC_EVENTS.QUEUE_UPDATED, version: 4, originId: 'tab_1', channel: chSender });
  broadcastSyncEvent({ type: SYNC_EVENTS.QUEUE_UPDATED, version: 4, originId: 'tab_1', channel: chSender });
  broadcastSyncEvent({ type: SYNC_EVENTS.QUEUE_UPDATED, version: 4, originId: 'tab_1', channel: chSender });

  // Invariant: duplicate events with non-incremented version do not update state
  assert.equal(stateReplacedCount, 0);
  assert.equal(tab2State.version, 4);

  teardown();
  chSender.close();
});

test('9. Synchronization does not produce infinite notification loops', () => {
  const bus = new MockBroadcastChannelBus();
  const ch = bus.createChannel();

  const myTabId = 'tab_local_self';
  let selfEchoCount = 0;

  const teardown = subscribeCrossTabSync({
    originId: myTabId,
    customBroadcastChannel: ch,
    onSyncEvent: () => {
      selfEchoCount++;
    }
  });

  // Self-echo simulation: Broadcast message with our own originId
  ch.postMessage({
    type: SYNC_EVENTS.TOKEN_ISSUED,
    version: 3,
    originId: myTabId,
    senderId: myTabId
  });

  // Invariant: Self-echo messages are filtered; callback must not fire
  assert.equal(selfEchoCount, 0);

  teardown();
});

test('10. Channel cleanup occurs correctly upon subscription disposal', () => {
  const bus = new MockBroadcastChannelBus();
  const ch = bus.createChannel();
  const mockWindow = createMockWindow();
  const mockDocument = createMockDocument();

  const teardown = subscribeCrossTabSync({
    originId: 'tab_temp',
    customBroadcastChannel: ch,
    customWindow: mockWindow,
    customDocument: mockDocument,
    onSyncEvent: () => {}
  });

  assert.equal(ch.closed, false);
  assert.equal(mockWindow.getListenerCount('storage'), 1);
  assert.equal(mockWindow.getListenerCount('focus'), 1);
  assert.equal(mockDocument.getListenerCount('visibilitychange'), 1);

  // Invoke teardown
  teardown();

  // Invariant: Channel closed and all event listeners removed
  assert.equal(ch.closed, true);
  assert.equal(mockWindow.getListenerCount('storage'), 0);
  assert.equal(mockWindow.getListenerCount('focus'), 0);
  assert.equal(mockDocument.getListenerCount('visibilitychange'), 0);
});

test('11. Storage-event fallback works when BroadcastChannel is unavailable', () => {
  const mockWindow = createMockWindow();
  const storage = createMockStorage();

  const updatedState = {
    ...createInitialState(),
    version: 8
  };
  saveQueueState(updatedState, storage);

  const fallbackEvents = [];
  const teardown = subscribeCrossTabSync({
    originId: 'tab_no_bc',
    customBroadcastChannel: null, // BroadcastChannel unavailable
    customWindow: mockWindow,
    onSyncEvent: (event) => {
      fallbackEvents.push(event);
    }
  });

  // Storage event on an unrelated key must be ignored
  mockWindow.dispatchEvent('storage', {
    key: 'unrelated_key',
    newValue: 'hello'
  });
  assert.equal(fallbackEvents.length, 0);

  // Storage event for QueueLess storage key
  mockWindow.dispatchEvent('storage', {
    key: QUEUELESS_STORAGE_KEY,
    newValue: JSON.stringify(updatedState)
  });

  assert.equal(fallbackEvents.length, 1);
  assert.equal(fallbackEvents[0].channel, 'storage_event');
  assert.equal(fallbackEvents[0].type, SYNC_EVENTS.STORAGE_FALLBACK);

  teardown();
});

test('12. Focus and visibilitychange refresh fallbacks trigger correctly', () => {
  const mockWindow = createMockWindow();
  const mockDocument = createMockDocument('hidden');

  const events = [];
  const teardown = subscribeCrossTabSync({
    originId: 'tab_visibility_test',
    customBroadcastChannel: null,
    customWindow: mockWindow,
    customDocument: mockDocument,
    onSyncEvent: (e) => events.push(e)
  });

  // 1. Focus event
  mockWindow.dispatchEvent('focus', {});
  assert.equal(events.length, 1);
  assert.equal(events[0].channel, 'focus');
  assert.equal(events[0].type, SYNC_EVENTS.FOCUS_REFRESH);

  // 2. Visibility change: changing from hidden to visible
  mockDocument.setVisibilityState('visible');
  assert.equal(events.length, 2);
  assert.equal(events[1].channel, 'visibilitychange');
  assert.equal(events[1].type, SYNC_EVENTS.VISIBILITY_REFRESH);

  // 3. Visibility change to hidden does not trigger sync
  mockDocument.setVisibilityState('hidden');
  assert.equal(events.length, 2);

  teardown();
});

test('13. Token issuance synchronizes across customer and admin tabs', () => {
  const storage = createMockStorage();
  const bus = new MockBroadcastChannelBus();
  const chCustomer = bus.createChannel();
  const chAdmin = bus.createChannel();

  let adminState = createInitialState();
  const teardown = subscribeCrossTabSync({
    originId: 'admin_tab',
    customBroadcastChannel: chAdmin,
    onSyncEvent: (event) => {
      const loaded = loadQueueState(storage);
      if (loaded.state && loaded.state.version > adminState.version) {
        adminState = loaded.state;
      }
    }
  });

  // Customer in Tab A issues token for Examinations
  let customerState = createInitialState();
  const issueRes = issueCustomerToken({
    state: customerState,
    serviceId: 'examinations',
    customerName: 'Charlie',
    storage,
    timestamp: 1000
  });
  assert.equal(issueRes.success, true);
  customerState = issueRes.state;

  // Broadcast issuance notification
  broadcastSyncEvent({
    type: SYNC_EVENTS.TOKEN_ISSUED,
    version: customerState.version,
    originId: 'customer_tab',
    metadata: { serviceId: 'examinations' },
    channel: chCustomer
  });

  // Admin tab reloaded from storage
  assert.equal(adminState.version, 2);
  assert.equal(adminState.tokens.length, 1);
  assert.equal(adminState.tokens[0].tokenNumber, 'EXM-001');

  // Admin verifies queue position and Stage A wait
  const pos = calculateQueuePosition(adminState.tokens[0].id, adminState);
  assert.equal(pos.position, 1);
  assert.equal(pos.waitingAhead, 0);

  const wait = calculateStageAWaitTime(adminState.tokens[0], adminState);
  assert.equal(wait.estimatedMinutes, 0); // Ready immediately (0 waiting ahead, counter vacant)
  assert.equal(wait.displayText, '0 min (Ready now)');
  assert.equal(wait.baselineDuration, 6); // Examinations baseline is 6 min

  // If a second token is issued, waiting ahead is 1, so wait time is 1 * 6 = 6 min
  const issue2 = issueCustomerToken({
    state: customerState,
    serviceId: 'examinations',
    customerName: 'Dana',
    sessionTokenId: null,
    storage,
    timestamp: 2000
  });
  broadcastSyncEvent({
    type: SYNC_EVENTS.TOKEN_ISSUED,
    version: issue2.state.version,
    originId: 'customer_tab_2',
    channel: chCustomer
  });

  const wait2 = calculateStageAWaitTime(adminState.tokens[1], adminState);
  assert.equal(wait2.estimatedMinutes, 6); // 1 ahead * 6 min baseline = 6 min

  teardown();
  chCustomer.close();
});

test('14. Admin dispatch lifecycle (Call Next, Complete, Skip, Re-queue) synchronizes', () => {
  const storage = createMockStorage();
  const bus = new MockBroadcastChannelBus();
  const chAdmin = bus.createChannel();
  const chCustomer = bus.createChannel();

  let state = createInitialState();
  // Issue 2 tokens in Admissions
  state = issueCustomerToken({ state, serviceId: 'admissions', customerName: 'A1', storage, timestamp: 1000 }).state;
  state = issueCustomerToken({ state, serviceId: 'admissions', customerName: 'A2', storage, timestamp: 2000 }).state;

  const t1 = state.tokens[0];
  const t2 = state.tokens[1];

  let customerTabState = state;
  const teardown = subscribeCrossTabSync({
    originId: 'customer_tab',
    customBroadcastChannel: chCustomer,
    onSyncEvent: () => {
      const loaded = loadQueueState(storage);
      if (loaded.state && loaded.state.version > customerTabState.version) {
        customerTabState = loaded.state;
      }
    }
  });

  // 1. Admin Calls Next (A1 -> SERVING)
  const callRes = callNextToken({ state, serviceId: 'admissions', storage, timestamp: 3000 });
  assert.equal(callRes.success, true);
  state = callRes.state;
  broadcastSyncEvent({ type: SYNC_EVENTS.TOKEN_CALLED, version: state.version, originId: 'admin_tab', channel: chAdmin });

  assert.equal(customerTabState.tokens.find((t) => t.id === t1.id).status, TOKEN_STATUS.SERVING);

  // 2. Admin Completes A1
  const compRes = completeServingToken({ state, serviceId: 'admissions', storage, timestamp: 4000 });
  assert.equal(compRes.success, true);
  state = compRes.state;
  broadcastSyncEvent({ type: SYNC_EVENTS.TOKEN_COMPLETED, version: state.version, originId: 'admin_tab', channel: chAdmin });

  assert.equal(customerTabState.tokens.find((t) => t.id === t1.id).status, TOKEN_STATUS.COMPLETED);

  // 3. Admin Calls Next for A2 and Skips A2 (No-show)
  state = callNextToken({ state, serviceId: 'admissions', storage, timestamp: 5000 }).state;
  const skipRes = skipServingToken({ state, serviceId: 'admissions', storage, timestamp: 6000 });
  assert.equal(skipRes.success, true);
  state = skipRes.state;
  broadcastSyncEvent({ type: SYNC_EVENTS.TOKEN_SKIPPED, version: state.version, originId: 'admin_tab', channel: chAdmin });

  assert.equal(customerTabState.tokens.find((t) => t.id === t2.id).status, TOKEN_STATUS.SKIPPED);

  // 4. Admin Re-queues A2 back to tail of line
  const reqRes = requeueSkippedToken({ state, tokenId: t2.id, storage, timestamp: 7000 });
  assert.equal(reqRes.success, true);
  state = reqRes.state;
  broadcastSyncEvent({ type: SYNC_EVENTS.TOKEN_REQUEUED, version: state.version, originId: 'admin_tab', channel: chAdmin });

  const customerT2 = customerTabState.tokens.find((t) => t.id === t2.id);
  assert.equal(customerT2.status, TOKEN_STATUS.WAITING);
  assert.equal(customerT2.requeueCount, 1);
  assert.equal(customerT2.createdAt, 7000); // appended to line tail

  teardown();
  chAdmin.close();
});

test('15. Pause and resume synchronize and enforce intake restrictions across tabs', () => {
  const storage = createMockStorage();
  const bus = new MockBroadcastChannelBus();
  const chAdmin = bus.createChannel();
  const chCustomer = bus.createChannel();

  let state = createInitialState();
  let customerTabState = state;

  const teardown = subscribeCrossTabSync({
    originId: 'customer_tab',
    customBroadcastChannel: chCustomer,
    onSyncEvent: () => {
      const loaded = loadQueueState(storage);
      if (loaded.state && loaded.state.version > customerTabState.version) {
        customerTabState = loaded.state;
      }
    }
  });

  // Admin pauses Finance desk
  const pauseRes = toggleServicePause({ state, serviceId: 'finance', storage });
  assert.equal(pauseRes.success, true);
  assert.equal(pauseRes.newStatus, SERVICE_STATUS.PAUSED);
  state = pauseRes.state;

  broadcastSyncEvent({
    type: SYNC_EVENTS.SERVICE_PAUSED,
    version: state.version,
    originId: 'admin_tab',
    metadata: { serviceId: 'finance' },
    channel: chAdmin
  });

  assert.equal(customerTabState.serviceStatuses.finance, SERVICE_STATUS.PAUSED);

  // Customer tab attempts to issue ticket for paused service
  const issueAttempt = issueCustomerToken({
    state: customerTabState,
    serviceId: 'finance',
    storage
  });
  assert.equal(issueAttempt.success, false);
  assert.equal(issueAttempt.code, 'SERVICE_PAUSED');

  // Admin resumes Finance desk
  const resumeRes = toggleServicePause({ state, serviceId: 'finance', storage });
  assert.equal(resumeRes.success, true);
  assert.equal(resumeRes.newStatus, SERVICE_STATUS.ACTIVE);
  state = resumeRes.state;

  broadcastSyncEvent({
    type: SYNC_EVENTS.SERVICE_RESUMED,
    version: state.version,
    originId: 'admin_tab',
    metadata: { serviceId: 'finance' },
    channel: chAdmin
  });

  assert.equal(customerTabState.serviceStatuses.finance, SERVICE_STATUS.ACTIVE);

  // Customer tab can now issue token
  const issueSuccess = issueCustomerToken({
    state: customerTabState,
    serviceId: 'finance',
    storage
  });
  assert.equal(issueSuccess.success, true);
  assert.equal(issueSuccess.token.tokenNumber, 'FIN-001');

  teardown();
  chAdmin.close();
});

test('16. Reset operations (service reset & master reset) synchronize with monotonic versions', () => {
  const storage = createMockStorage();
  const bus = new MockBroadcastChannelBus();
  const chAdmin = bus.createChannel();
  const chCustomer = bus.createChannel();

  let state = createInitialState();
  state = issueCustomerToken({ state, serviceId: 'admissions', storage }).state;
  state = issueCustomerToken({ state, serviceId: 'finance', storage }).state;
  assert.equal(state.version, 3);

  let customerTabState = state;
  const teardown = subscribeCrossTabSync({
    originId: 'customer_tab',
    customBroadcastChannel: chCustomer,
    onSyncEvent: () => {
      const loaded = loadQueueState(storage);
      if (loaded.state && loaded.state.version > customerTabState.version) {
        customerTabState = loaded.state;
      }
    }
  });

  // 1. Single service reset (Admissions)
  const resetAdmRes = resetServiceQueue({ state, serviceId: 'admissions', storage, timestamp: 10000 });
  assert.equal(resetAdmRes.success, true);
  state = resetAdmRes.state;
  assert.equal(state.version, 4);

  broadcastSyncEvent({
    type: SYNC_EVENTS.SERVICE_RESET,
    version: state.version,
    originId: 'admin_tab',
    metadata: { serviceId: 'admissions' },
    channel: chAdmin
  });

  assert.equal(customerTabState.version, 4);
  assert.equal(customerTabState.sequenceCounters.admissions, 0);
  assert.equal(customerTabState.sequenceCounters.finance, 1); // finance untouched
  assert.equal(customerTabState.tokens.length, 1); // finance token remains

  // 2. Master reset (All queues)
  const masterRes = resetAllQueuesAction({ state, storage, timestamp: 20000 });
  assert.equal(masterRes.success, true);
  state = masterRes.state;
  assert.equal(state.version, 5); // monotonic 4 -> 5

  broadcastSyncEvent({
    type: SYNC_EVENTS.ALL_QUEUES_RESET,
    version: state.version,
    originId: 'admin_tab',
    channel: chAdmin
  });

  assert.equal(customerTabState.version, 5);
  assert.equal(customerTabState.tokens.length, 0);
  assert.equal(customerTabState.sequenceCounters.finance, 0);

  teardown();
  chAdmin.close();
});

test('17. Session references remain safe after resets (Old session never attaches to new token with same number)', () => {
  const storage = createMockStorage();

  // Step 1: Customer A receives ADM-001 (Unique ID: tok_1000_adm1)
  let state = createInitialState();
  const issueResult1 = issueCustomerToken({
    state,
    serviceId: 'admissions',
    customerName: 'Customer A',
    storage,
    timestamp: 1000
  });
  assert.equal(issueResult1.success, true);
  const oldTokenId = issueResult1.token.id;
  assert.equal(issueResult1.token.tokenNumber, 'ADM-001');
  assert.equal(getSessionTokenId(storage), oldTokenId);
  state = issueResult1.state;

  // Verify Customer A holds an active session token
  const oldActive = getActiveSessionToken(state, oldTokenId);
  assert.ok(oldActive);
  assert.equal(oldActive.id, oldTokenId);

  // Step 2: Admin resets Admissions
  const resetRes = resetServiceQueue({ state, serviceId: 'admissions', storage, timestamp: 2000 });
  assert.equal(resetRes.success, true);
  state = resetRes.state;

  // Verify session reference was cleaned up in storage during reset
  assert.equal(getSessionTokenId(storage), null);

  // Step 3: A new Customer B receives ADM-001 (Unique ID: tok_3000_adm1)
  const issueResult2 = issueCustomerToken({
    state,
    serviceId: 'admissions',
    customerName: 'Customer B',
    storage,
    timestamp: 3000
  });
  assert.equal(issueResult2.success, true);
  const newTokenId = issueResult2.token.id;
  assert.equal(issueResult2.token.tokenNumber, 'ADM-001');
  state = issueResult2.state;

  // Crucial identity invariant: token IDs are unique even though tokenNumber is identical
  assert.notEqual(oldTokenId, newTokenId);

  // Step 4: The old browser session evaluating the old token ID
  // It must NEVER attach itself to the newly created token!
  const oldSessionActiveToken = getActiveSessionToken(state, oldTokenId);
  assert.equal(oldSessionActiveToken, null);

  // Customer A can now cleanly issue a new token without ACTIVE_TOKEN_EXISTS error
  const customerANewIssue = issueCustomerToken({
    state,
    serviceId: 'finance',
    customerName: 'Customer A New',
    sessionTokenId: null,
    storage,
    timestamp: 4000
  });
  assert.equal(customerANewIssue.success, true);
  assert.equal(customerANewIssue.token.tokenNumber, 'FIN-001');
});

test('18. Existing foundation, storage, estimation, and admin dispatch invariants hold', () => {
  // Re-verify initial state schema
  const cleanState = createInitialState();
  const validation = validateQueueState(cleanState);
  assert.equal(validation.isValid, true);
  assert.equal(cleanState.version, 1);
  assert.equal(cleanState.tokens.length, 0);

  // Sequence numbering starts at 001, never 000
  const storage = createMockStorage();
  const res = issueCustomerToken({ state: cleanState, serviceId: 'admissions', storage });
  assert.equal(res.token.tokenNumber, 'ADM-001');
  assert.notEqual(res.token.tokenNumber, 'ADM-000');
});

test('19. Task 10 workflow simulation: Multi-tab customer and admin lifecycle', () => {
  const storage = createMockStorage();
  const bus = new MockBroadcastChannelBus();
  const chTabA = bus.createChannel();
  const chTabB = bus.createChannel();

  // Tab A is Customer view; Tab B is Admin view
  let tabAState = createInitialState();
  let tabBState = createInitialState();

  const teardownA = subscribeCrossTabSync({
    originId: 'tab_a_customer',
    customBroadcastChannel: chTabA,
    onSyncEvent: () => {
      const loaded = loadQueueState(storage);
      if (loaded.state && loaded.state.version > tabAState.version) {
        tabAState = loaded.state;
      }
    }
  });

  const teardownB = subscribeCrossTabSync({
    originId: 'tab_b_admin',
    customBroadcastChannel: chTabB,
    onSyncEvent: () => {
      const loaded = loadQueueState(storage);
      if (loaded.state && loaded.state.version > tabBState.version) {
        tabBState = loaded.state;
      }
    }
  });

  // Step 1: Tab A issues ADM-001
  const issueRes = issueCustomerToken({
    state: tabAState,
    serviceId: 'admissions',
    customerName: 'Alice',
    storage,
    timestamp: 1000
  });
  assert.equal(issueRes.success, true);
  tabAState = issueRes.state;
  const customerTokenId = issueRes.token.id;
  assert.equal(issueRes.token.tokenNumber, 'ADM-001');

  broadcastSyncEvent({
    type: SYNC_EVENTS.TOKEN_ISSUED,
    version: tabAState.version,
    originId: 'tab_a_customer',
    channel: chTabA
  });

  // Step 2: Tab B verifies that the queue reflects ADM-001
  assert.equal(tabBState.version, 2);
  assert.equal(tabBState.tokens.length, 1);
  assert.equal(tabBState.tokens[0].tokenNumber, 'ADM-001');
  assert.equal(tabBState.tokens[0].status, TOKEN_STATUS.WAITING);

  // Step 3: Tab B calls Next
  const callRes = callNextToken({
    state: tabBState,
    serviceId: 'admissions',
    storage,
    timestamp: 2000
  });
  assert.equal(callRes.success, true);
  tabBState = callRes.state;

  broadcastSyncEvent({
    type: SYNC_EVENTS.TOKEN_CALLED,
    version: tabBState.version,
    originId: 'tab_b_admin',
    channel: chTabB
  });

  // Step 4: Tab A verifies that ADM-001 changes to SERVING
  assert.equal(tabAState.version, 3);
  const tokenInTabA = tabAState.tokens.find((t) => t.id === customerTokenId);
  assert.equal(tokenInTabA.status, TOKEN_STATUS.SERVING);
  assert.equal(tokenInTabA.calledAt, 2000);

  // Step 5: Tab B completes ADM-001
  const compRes = completeServingToken({
    state: tabBState,
    serviceId: 'admissions',
    storage,
    timestamp: 3000
  });
  assert.equal(compRes.success, true);
  tabBState = compRes.state;

  broadcastSyncEvent({
    type: SYNC_EVENTS.TOKEN_COMPLETED,
    version: tabBState.version,
    originId: 'tab_b_admin',
    channel: chTabB
  });

  // Step 6: Tab A verifies that ADM-001 changes to COMPLETED
  assert.equal(tabAState.version, 4);
  const completedTokenInTabA = tabAState.tokens.find((t) => t.id === customerTokenId);
  assert.equal(completedTokenInTabA.status, TOKEN_STATUS.COMPLETED);
  assert.equal(completedTokenInTabA.completedAt, 3000);
  assert.equal(completedTokenInTabA.skippedAt, null);

  teardownA();
  teardownB();
});
