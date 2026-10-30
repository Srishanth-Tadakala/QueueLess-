import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialState,
  TOKEN_STATUS,
  SERVICE_STATUS,
  createToken,
  applyTransition,
  canTransition,
  validateQueueState
} from '../src/utils/queueModel.js';

import {
  APPROVED_SERVICES,
  formatTokenNumber
} from '../src/utils/services.js';

import {
  saveQueueState,
  loadQueueState,
  QUEUELESS_STORAGE_KEY
} from '../src/utils/storage.js';

import {
  issueCustomerToken,
  cancelCustomerToken,
  getActiveSessionToken,
  SESSION_TOKEN_KEY
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
  calculateStageAWaitTime,
  calculateStageBWaitTime,
  getServiceQueue,
  getQueueMetrics
} from '../src/utils/estimationEngine.js';

import {
  isEligibleCompletedToken,
  extractTokenDurationMinutes,
  getValidCompletedTransactions,
  calculateRollingAverage,
  getAllServicesAnalytics,
  ESTIMATION_METHOD,
  DATA_SUFFICIENCY,
  SAMPLE_WINDOW_SIZE,
  MIN_DURATION_CLAMP_MINUTES,
  MAX_DURATION_CLAMP_MINUTES
} from '../src/utils/durationAnalytics.js';

import {
  SYNC_CHANNEL_NAME,
  SYNC_EVENTS,
  broadcastSyncEvent,
  subscribeCrossTabSync,
  generateOriginId
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
 * Mock BroadcastChannel bus simulating multi-tab message dispatch
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
        for (const ch of bus.channels) {
          if (ch !== instance && !ch.closed && ch.name === name) {
            if (typeof ch.onmessage === 'function') {
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

// ============================================================================
// SUITE 1: QUEUE LIFECYCLE AUDIT & TRANSITION INVARIANTS
// ============================================================================

test('QA-1: Lifecycle State Machine - Valid transition WAITING -> CANCELLED records cancelledAt and clears completedAt', () => {
  let state = createInitialState();
  const created = createToken(state, 'admissions', 'Test User', 1730000000000);
  state = created.state;
  const tokenId = created.token.id;

  const cancelTime = 1730000010000;
  const res = applyTransition(state, tokenId, TOKEN_STATUS.CANCELLED, cancelTime);

  assert.equal(res.success, true);
  assert.equal(res.token.status, TOKEN_STATUS.CANCELLED);
  assert.equal(res.token.cancelledAt, cancelTime);
  assert.equal(res.token.completedAt, null, 'Cancelled token must NOT have completedAt set');
  assert.equal(res.token.skippedAt, null);
});

test('QA-2: Lifecycle State Machine - Terminal states (COMPLETED, CANCELLED) strictly reject any subsequent transitions', () => {
  let state = createInitialState();
  const t1 = createToken(state, 'admissions', 'Alice', 1000);
  const t2 = createToken(t1.state, 'finance', 'Bob', 1000);
  state = t2.state;

  // Complete t1
  state = applyTransition(state, t1.token.id, TOKEN_STATUS.SERVING, 2000).state;
  state = applyTransition(state, t1.token.id, TOKEN_STATUS.COMPLETED, 3000).state;

  // Cancel t2
  state = applyTransition(state, t2.token.id, TOKEN_STATUS.CANCELLED, 4000).state;

  // Try transitioning COMPLETED token to WAITING or SERVING
  const invComp1 = applyTransition(state, t1.token.id, TOKEN_STATUS.WAITING);
  assert.equal(invComp1.success, false);
  assert.ok(invComp1.reason.includes('terminal state'));

  const invComp2 = applyTransition(state, t1.token.id, TOKEN_STATUS.SERVING);
  assert.equal(invComp2.success, false);

  // Try transitioning CANCELLED token to WAITING or SERVING
  const invCanc1 = applyTransition(state, t2.token.id, TOKEN_STATUS.WAITING);
  assert.equal(invCanc1.success, false);
  assert.ok(invCanc1.reason.includes('terminal state'));

  const invCanc2 = applyTransition(state, t2.token.id, TOKEN_STATUS.SERVING);
  assert.equal(invCanc2.success, false);
});

test('QA-3: Lifecycle State Machine - SERVING token cannot transition directly to CANCELLED or WAITING', () => {
  let state = createInitialState();
  const t = createToken(state, 'examinations', 'Charlie', 1000);
  state = applyTransition(t.state, t.token.id, TOKEN_STATUS.SERVING, 2000).state;

  const inv1 = applyTransition(state, t.token.id, TOKEN_STATUS.CANCELLED);
  assert.equal(inv1.success, false);
  assert.ok(inv1.reason.includes('Active tokens must be COMPLETED or SKIPPED'));

  const inv2 = applyTransition(state, t.token.id, TOKEN_STATUS.WAITING);
  assert.equal(inv2.success, false);
});

test('QA-4: Lifecycle Invariant - Single serving customer per counter invariant enforced across all entry points', () => {
  let state = createInitialState();
  const t1 = createToken(state, 'admissions', 'Cust1', 1000);
  const t2 = createToken(t1.state, 'admissions', 'Cust2', 1001);
  state = t2.state;

  // Dispatch t1 to counter
  const call1 = callNextToken({ state, serviceId: 'admissions', timestamp: 2000 });
  assert.equal(call1.success, true);
  state = call1.state;

  // Attempting to call next token for admissions while t1 is SERVING
  const call2 = callNextToken({ state, serviceId: 'admissions', timestamp: 2100 });
  assert.equal(call2.success, false);
  assert.equal(call2.code, 'COUNTER_OCCUPIED');
  assert.equal(call2.servingToken.id, t1.token.id);

  // Directly attempting applyTransition to SERVING also rejected via canTransition guard
  const directTransition = applyTransition(state, t2.token.id, TOKEN_STATUS.SERVING, 2200);
  assert.equal(directTransition.success, false);
  assert.ok(directTransition.reason.includes('currently SERVING'));
});

test('QA-5: Lifecycle Invariant - Re-queued token appends strictly to the tail of the waiting line behind newer waiting tokens', () => {
  let state = createInitialState();
  // Cust 1 arrives at t=100
  state = createToken(state, 'admissions', 'Cust 1', 100).state;
  const id1 = state.tokens[0].id;

  // Cust 1 called and skipped at t=200, 300
  state = applyTransition(state, id1, TOKEN_STATUS.SERVING, 200).state;
  state = applyTransition(state, id1, TOKEN_STATUS.SKIPPED, 300).state;

  // Cust 2 arrives at t=400
  state = createToken(state, 'admissions', 'Cust 2', 400).state;
  // Cust 3 arrives at t=500
  state = createToken(state, 'admissions', 'Cust 3', 500).state;

  // Cust 1 re-queued at t=600
  const requeueRes = requeueSkippedToken({ state, tokenId: id1, timestamp: 600 });
  assert.equal(requeueRes.success, true);
  state = requeueRes.state;

  const { waitingTokens } = getServiceQueue(state, 'admissions');
  assert.equal(waitingTokens.length, 3);
  // Cust 2 must be #1, Cust 3 must be #2, Re-queued Cust 1 must be #3 at tail!
  assert.equal(waitingTokens[0].customerName, 'Cust 2');
  assert.equal(waitingTokens[1].customerName, 'Cust 3');
  assert.equal(waitingTokens[2].customerName, 'Cust 1');
  assert.equal(waitingTokens[2].requeueCount, 1);
});

test('QA-6: Lifecycle Invariant - Resetting one service leaves all other services and counters completely intact', () => {
  const mockStorage = createMockStorage();
  let state = createInitialState();

  // Populate Admissions and Finance
  state = createToken(state, 'admissions', 'Adm1', 100).state;
  state = createToken(state, 'admissions', 'Adm2', 200).state;
  state = createToken(state, 'finance', 'Fin1', 300).state;
  state = createToken(state, 'examinations', 'Exm1', 400).state;

  saveQueueState(state, mockStorage);

  assert.equal(state.sequenceCounters.admissions, 2);
  assert.equal(state.sequenceCounters.finance, 1);
  assert.equal(state.sequenceCounters.examinations, 1);

  // Reset Admissions only
  const resetRes = resetServiceQueue({ state, serviceId: 'admissions', storage: mockStorage });
  assert.equal(resetRes.success, true);
  state = resetRes.state;

  assert.equal(state.sequenceCounters.admissions, 0, 'Admissions counter must be 0');
  assert.equal(state.sequenceCounters.finance, 1, 'Finance counter must be preserved');
  assert.equal(state.sequenceCounters.examinations, 1, 'Examinations counter must be preserved');

  // Verify token filtering: only admissions tokens removed
  const admTokens = state.tokens.filter((t) => t.serviceId === 'admissions');
  const finTokens = state.tokens.filter((t) => t.serviceId === 'finance');
  const exmTokens = state.tokens.filter((t) => t.serviceId === 'examinations');

  assert.equal(admTokens.length, 0);
  assert.equal(finTokens.length, 1);
  assert.equal(exmTokens.length, 1);
});

test('QA-7: Lifecycle Invariant - Master Reset All cleanly restores initial schema, increments version, and clears session', () => {
  const mockStorage = createMockStorage();
  let state = createInitialState();

  state = createToken(state, 'admissions', 'Adm1').state;
  mockStorage.setItem(SESSION_TOKEN_KEY, state.tokens[0].id);
  saveQueueState(state, mockStorage);

  const initialVersion = state.version;
  const resetRes = resetAllQueuesAction({ state, storage: mockStorage, timestamp: 9999 });

  assert.equal(resetRes.success, true);
  assert.equal(resetRes.state.version, initialVersion + 1, 'Version must increment monotonically');
  assert.deepEqual(resetRes.state.tokens, []);
  assert.equal(resetRes.state.sequenceCounters.admissions, 0);
  assert.equal(resetRes.state.sequenceCounters.finance, 0);
  assert.equal(resetRes.state.sequenceCounters.examinations, 0);
  assert.equal(resetRes.state.serviceStatuses.admissions, SERVICE_STATUS.ACTIVE);
  assert.equal(resetRes.state.serviceStatuses.finance, SERVICE_STATUS.ACTIVE);
  assert.equal(resetRes.state.serviceStatuses.examinations, SERVICE_STATUS.ACTIVE);

  // Session reference must be cleared
  assert.equal(mockStorage.getItem(SESSION_TOKEN_KEY), null);
});

// ============================================================================
// SUITE 2: ADAPTIVE ESTIMATION AUDIT & EDGE CASES
// ============================================================================

test('QA-8: Estimation Engine - Stage A baseline wait calculation across Admissions, Finance, and Examinations', () => {
  let state = createInitialState();
  const adm1 = createToken(state, 'admissions', 'A1', 100);
  const adm2 = createToken(adm1.state, 'admissions', 'A2', 200);
  const fin1 = createToken(adm2.state, 'finance', 'F1', 300);
  const fin2 = createToken(fin1.state, 'finance', 'F2', 400);
  const exm1 = createToken(fin2.state, 'examinations', 'E1', 500);
  const exm2 = createToken(exm1.state, 'examinations', 'E2', 600);
  state = exm2.state;

  // Counter is vacant:
  // First waiting customer in each line has wait = 0 (Ready now)
  const admEst1 = calculateStageAWaitTime(adm1.token.id, state);
  assert.equal(admEst1.estimatedMinutes, 0);
  assert.equal(admEst1.isReadyNow, true);

  const finEst1 = calculateStageAWaitTime(fin1.token.id, state);
  assert.equal(finEst1.estimatedMinutes, 0);
  assert.equal(finEst1.isReadyNow, true);

  const exmEst1 = calculateStageAWaitTime(exm1.token.id, state);
  assert.equal(exmEst1.estimatedMinutes, 0);
  assert.equal(exmEst1.isReadyNow, true);

  // Second customer in line waits behind first customer (N_ahead = 1):
  // Admissions baseline: 5 min
  const admEst2 = calculateStageAWaitTime(adm2.token.id, state);
  assert.equal(admEst2.estimatedMinutes, 5);

  // Finance baseline: 3 min
  const finEst2 = calculateStageAWaitTime(fin2.token.id, state);
  assert.equal(finEst2.estimatedMinutes, 3);

  // Examinations baseline: 6 min
  const exmEst2 = calculateStageAWaitTime(exm2.token.id, state);
  assert.equal(exmEst2.estimatedMinutes, 6);
});

test('QA-9: Estimation Engine - Stage B rolling average with 0 samples falls back to baseline and reports NO_HISTORY', () => {
  const state = createInitialState();
  const result = calculateRollingAverage('admissions', state);

  assert.equal(result.isUsingFallback, true);
  assert.equal(result.sampleCount, 0);
  assert.equal(result.rollingAverageMinutes, null);
  assert.equal(result.effectiveDurationMinutes, 5); // Admissions baseline
  assert.equal(result.dataSufficiency, DATA_SUFFICIENCY.NO_HISTORY);
  assert.equal(result.estimationMethod, ESTIMATION_METHOD.STAGE_A_BASELINE);
});

test('QA-10: Estimation Engine - Stage B rolling average with 1, 3, and 5 samples calculates correct arithmetic mean', () => {
  // Helper to construct a completed token
  function makeCompletedToken(id, serviceId, calledAt, completedAt) {
    return {
      id,
      tokenNumber: `${serviceId.substring(0, 3).toUpperCase()}-001`,
      serviceId,
      status: TOKEN_STATUS.COMPLETED,
      calledAt,
      completedAt,
      createdAt: calledAt - 60000
    };
  }

  // 1 sample: 4.0 minutes (240,000 ms)
  const tokens1 = [
    makeCompletedToken('t1', 'admissions', 1000000, 1000000 + 240000)
  ];
  const r1 = calculateRollingAverage('admissions', tokens1);
  assert.equal(r1.isUsingFallback, false);
  assert.equal(r1.sampleCount, 1);
  assert.equal(r1.rollingAverageMinutes, 4.0);
  assert.equal(r1.dataSufficiency, DATA_SUFFICIENCY.INSUFFICIENT_HISTORY);

  // 3 samples: 4m, 6m, 8m -> Mean: (4 + 6 + 8) / 3 = 6.0 minutes
  const tokens3 = [
    makeCompletedToken('t1', 'admissions', 1000000, 1000000 + 240000), // 4m
    makeCompletedToken('t2', 'admissions', 2000000, 2000000 + 360000), // 6m
    makeCompletedToken('t3', 'admissions', 3000000, 3000000 + 480000)  // 8m
  ];
  const r3 = calculateRollingAverage('admissions', tokens3);
  assert.equal(r3.sampleCount, 3);
  assert.equal(r3.rollingAverageMinutes, 6.0);
  assert.equal(r3.dataSufficiency, DATA_SUFFICIENCY.INSUFFICIENT_HISTORY);

  // 5 samples: 4m, 6m, 8m, 5m, 7m -> Mean: (4 + 6 + 8 + 5 + 7) / 5 = 6.0 minutes
  const tokens5 = [
    ...tokens3,
    makeCompletedToken('t4', 'admissions', 4000000, 4000000 + 300000), // 5m
    makeCompletedToken('t5', 'admissions', 5000000, 5000000 + 420000)  // 7m
  ];
  const r5 = calculateRollingAverage('admissions', tokens5);
  assert.equal(r5.sampleCount, 5);
  assert.equal(r5.rollingAverageMinutes, 6.0);
  assert.equal(r5.dataSufficiency, DATA_SUFFICIENCY.SUFFICIENT_HISTORY);
});

test('QA-11: Estimation Engine - Stage B rolling window caps strictly at 5 newest completed transactions', () => {
  function makeCompletedToken(id, calledAt, durationMinutes) {
    return {
      id,
      tokenNumber: `ADM-${id}`,
      serviceId: 'admissions',
      status: TOKEN_STATUS.COMPLETED,
      calledAt,
      completedAt: calledAt + (durationMinutes * 60000),
      createdAt: calledAt - 60000
    };
  }

  // 7 completed tokens at increasing timestamps:
  // t1: 10m (completed at t=10) [Oldest - excluded]
  // t2: 10m (completed at t=20) [Excluded]
  // t3: 2m  (completed at t=30) [Included]
  // t4: 2m  (completed at t=40) [Included]
  // t5: 2m  (completed at t=50) [Included]
  // t6: 2m  (completed at t=60) [Included]
  // t7: 2m  (completed at t=70) [Newest - Included]
  const tokens = [
    makeCompletedToken('t1', 1000000, 10),
    makeCompletedToken('t2', 2000000, 10),
    makeCompletedToken('t3', 3000000, 2),
    makeCompletedToken('t4', 4000000, 2),
    makeCompletedToken('t5', 5000000, 2),
    makeCompletedToken('t6', 6000000, 2),
    makeCompletedToken('t7', 7000000, 2)
  ];

  const result = calculateRollingAverage('admissions', tokens);
  assert.equal(result.sampleCount, 5);
  assert.equal(result.totalValidTransactions, 7);
  // Average of newest 5 (all 2 min) must be 2.0 min, NOT polluted by older 10m transactions!
  assert.equal(result.rollingAverageMinutes, 2.0);
});

test('QA-12: Estimation Engine - Clamping boundary tests: 0.2m clamps to 1.0m, 45m clamps to 20.0m', () => {
  const tokenTooFast = {
    id: 'fast',
    serviceId: 'admissions',
    status: TOKEN_STATUS.COMPLETED,
    calledAt: 1000000,
    completedAt: 1000000 + 12000 // 0.2 minutes (12 seconds)
  };
  assert.equal(extractTokenDurationMinutes(tokenTooFast), 1.0, 'Durations < 1.0m must clamp to 1.0m');

  const tokenTooSlow = {
    id: 'slow',
    serviceId: 'admissions',
    status: TOKEN_STATUS.COMPLETED,
    calledAt: 1000000,
    completedAt: 1000000 + (45 * 60000) // 45 minutes
  };
  assert.equal(extractTokenDurationMinutes(tokenTooSlow), 20.0, 'Durations > 20.0m must clamp to 20.0m');

  const tokenExactMin = {
    id: 'exact1',
    serviceId: 'admissions',
    status: TOKEN_STATUS.COMPLETED,
    calledAt: 1000000,
    completedAt: 1000000 + 60000 // 1.0 min
  };
  assert.equal(extractTokenDurationMinutes(tokenExactMin), 1.0);

  const tokenExactMax = {
    id: 'exact20',
    serviceId: 'admissions',
    status: TOKEN_STATUS.COMPLETED,
    calledAt: 1000000,
    completedAt: 1000000 + (20 * 60000) // 20.0 min
  };
  assert.equal(extractTokenDurationMinutes(tokenExactMax), 20.0);
});

test('QA-13: Estimation Engine - Ineligible statuses and corrupted timestamps are rejected by isEligibleCompletedToken', () => {
  const base = {
    id: 'test',
    serviceId: 'admissions',
    status: TOKEN_STATUS.COMPLETED,
    calledAt: 1000000,
    completedAt: 1000000 + 300000
  };

  // Status not COMPLETED
  assert.equal(isEligibleCompletedToken({ ...base, status: TOKEN_STATUS.WAITING }), false);
  assert.equal(isEligibleCompletedToken({ ...base, status: TOKEN_STATUS.SERVING }), false);
  assert.equal(isEligibleCompletedToken({ ...base, status: TOKEN_STATUS.SKIPPED }), false);
  assert.equal(isEligibleCompletedToken({ ...base, status: TOKEN_STATUS.CANCELLED }), false);

  // Missing or negative timestamps
  assert.equal(isEligibleCompletedToken({ ...base, calledAt: null }), false);
  assert.equal(isEligibleCompletedToken({ ...base, calledAt: -500 }), false);
  assert.equal(isEligibleCompletedToken({ ...base, calledAt: NaN }), false);
  assert.equal(isEligibleCompletedToken({ ...base, completedAt: null }), false);
  assert.equal(isEligibleCompletedToken({ ...base, completedAt: 'invalid' }), false);

  // completedAt <= calledAt
  assert.equal(isEligibleCompletedToken({ ...base, completedAt: base.calledAt }), false);
  assert.equal(isEligibleCompletedToken({ ...base, completedAt: base.calledAt - 1000 }), false);

  // Unapproved service ID
  assert.equal(isEligibleCompletedToken({ ...base, serviceId: 'unknown_desk' }), false);
});

test('QA-14: Estimation Engine - Active serving elapsed time counts down without negative remainder', () => {
  let state = createInitialState();
  const t1 = createToken(state, 'admissions', 'Cust1', 1000);
  const t2 = createToken(t1.state, 'admissions', 'Cust2', 1001);
  state = t2.state;

  const calledAt = 1000000;
  state = applyTransition(state, t1.token.id, TOKEN_STATUS.SERVING, calledAt).state;

  // Scenario A: 2 minutes into a 5-minute baseline service -> Remaining = 3 min
  const estA = calculateStageAWaitTime(t2.token.id, state, calledAt + (2 * 60000));
  assert.equal(estA.remainingCurrentService, 3);
  assert.equal(estA.estimatedMinutes, 3); // 3m remaining + (0 ahead * 5) = 3m

  // Scenario B: 7 minutes into a 5-minute baseline service (overrun) -> Remaining = 0 (never negative)
  const estB = calculateStageAWaitTime(t2.token.id, state, calledAt + (7 * 60000));
  assert.equal(estB.remainingCurrentService, 0);
  assert.equal(estB.estimatedMinutes, 0);
  assert.ok(estB.displayText.includes('< 1 min'));
});

// ============================================================================
// SUITE 3: STORAGE ADAPTER & RECOVERY RESILIENCE
// ============================================================================

test('QA-15: Storage Adapter - Malformed JSON recovery cleanly initializes initial state with fallback_malformed', () => {
  const corruptedStorage = createMockStorage({
    [QUEUELESS_STORAGE_KEY]: '{"version": 2, "tokens": [broken_json_syntax...'
  });

  const loadRes = loadQueueState(corruptedStorage);
  assert.equal(loadRes.source, 'fallback_malformed');
  assert.ok(loadRes.error.includes('Malformed JSON'));
  assert.equal(validateQueueState(loadRes.state).isValid, true);
  assert.equal(loadRes.state.version, 1);
  assert.deepEqual(loadRes.state.tokens, []);
});

test('QA-16: Storage Adapter - Corrupted schema fails validation and triggers fallback_invalid_schema', () => {
  const invalidSchemaState = {
    version: 'not-a-number', // INVALID
    lastUpdatedAt: Date.now(),
    sequenceCounters: { admissions: -5 }, // INVALID negative
    serviceStatuses: { admissions: 'INVALID_STATUS' },
    tokens: 'not-an-array' // INVALID
  };

  const corruptedStorage = createMockStorage({
    [QUEUELESS_STORAGE_KEY]: JSON.stringify(invalidSchemaState)
  });

  const loadRes = loadQueueState(corruptedStorage);
  assert.equal(loadRes.source, 'fallback_invalid_schema');
  assert.equal(validateQueueState(loadRes.state).isValid, true);
});

test('QA-17: Storage Adapter - Storage write exhaustion (QuotaExceededError) returns failure safely without throwing', () => {
  const quotaStorage = {
    getItem() { return null; },
    setItem() {
      const err = new Error('Quota exceeded');
      err.name = 'QuotaExceededError';
      throw err;
    },
    removeItem() {}
  };

  const state = createInitialState();
  const saveRes = saveQueueState(state, quotaStorage);
  assert.equal(saveRes.success, false);
  assert.ok(saveRes.error.includes('Quota exceeded'));
});

// ============================================================================
// SUITE 4: CROSS-TAB SYNCHRONIZATION & EVENT INTEGRITY
// ============================================================================

test('QA-18: Cross-Tab Sync - State version ordering rejects stale or rollback versions', () => {
  const mockStorage = createMockStorage();
  const bus = new MockBroadcastChannelBus();

  // Tab 1 is currently at version 5
  let localState = {
    ...createInitialState(),
    version: 5,
    lastUpdatedAt: 1730000050000
  };
  saveQueueState(localState, mockStorage);

  const tabChannel = bus.createChannel(SYNC_CHANNEL_NAME);
  let localVersionUpdated = false;

  const unsubscribe = subscribeCrossTabSync({
    originId: 'tab_local',
    customBroadcastChannel: tabChannel,
    onSyncEvent: (event) => {
      const loaded = loadQueueState(mockStorage);
      if (loaded.state.version > localState.version) {
        localState = loaded.state;
        localVersionUpdated = true;
      }
    }
  });

  // Stale event arrived from another tab with version 4
  const externalChannel = bus.createChannel(SYNC_CHANNEL_NAME);
  // Storage was not updated to a higher version
  externalChannel.postMessage({
    type: SYNC_EVENTS.TOKEN_ISSUED,
    version: 4,
    originId: 'tab_external',
    timestamp: Date.now()
  });

  assert.equal(localVersionUpdated, false, 'Stale incoming state must not trigger a local state rollback');
  assert.equal(localState.version, 5);

  unsubscribe();
  tabChannel.close();
  externalChannel.close();
});

test('QA-19: Cross-Tab Sync - Self-echo suppression ignores messages originating from same originId', () => {
  const mockStorage = createMockStorage();
  const bus = new MockBroadcastChannelBus();

  const tabChannel = bus.createChannel(SYNC_CHANNEL_NAME);
  let eventProcessedCount = 0;

  const originId = 'tab_self_123';
  const unsubscribe = subscribeCrossTabSync({
    originId,
    customBroadcastChannel: tabChannel,
    onSyncEvent: () => {
      eventProcessedCount++;
    }
  });

  // Simulate self message
  tabChannel.onmessage({
    data: {
      type: SYNC_EVENTS.TOKEN_ISSUED,
      version: 2,
      originId,
      senderId: originId,
      timestamp: Date.now()
    }
  });

  assert.equal(eventProcessedCount, 0, 'Self-origin messages must be strictly ignored');

  unsubscribe();
  tabChannel.close();
});

test('QA-20: Cross-Tab Sync - Broadcast notifications contain zero customer PII', () => {
  const bus = new MockBroadcastChannelBus();
  const channel = bus.createChannel(SYNC_CHANNEL_NAME);

  const broadcastRes = broadcastSyncEvent({
    type: SYNC_EVENTS.TOKEN_ISSUED,
    version: 2,
    originId: 'tab_audit',
    metadata: {
      serviceId: 'admissions',
      // Attacker or mistake attempts passing customer info in metadata:
      customerName: 'Secret PII Student',
      studentId: '22CS999'
    },
    channel
  });

  assert.equal(broadcastRes.success, true);
  const payload = broadcastRes.payload;

  // Payload must ONLY contain approved fields
  assert.equal(payload.type, SYNC_EVENTS.TOKEN_ISSUED);
  assert.equal(payload.version, 2);
  assert.equal(payload.originId, 'tab_audit');
  assert.equal(payload.serviceId, 'admissions');
  assert.equal(payload.customerName, undefined, 'customerName must NOT be transmitted in broadcast payload');
  assert.equal(payload.studentId, undefined, 'studentId must NOT be transmitted in broadcast payload');
  assert.equal(payload.tokens, undefined, 'Raw tokens array must NOT be transmitted');

  channel.close();
});

// ============================================================================
// SUITE 5: DATA SANITIZATION, PRIVACY & VALIDATION
// ============================================================================

test('QA-21: Security & Privacy - Customer name input trimming and length truncation caps at 80 characters', () => {
  let state = createInitialState();

  // Test 1: Excessive length input (e.g. 200 characters)
  const longName = 'A'.repeat(200);
  const createdLong = createToken(state, 'admissions', longName);
  assert.equal(createdLong.token.customerName.length, 80, 'Customer name must be capped at 80 chars');

  // Test 2: Whitespace padding
  const paddedName = '   Jane Doe Student   ';
  const createdPadded = createToken(state, 'finance', paddedName);
  assert.equal(createdPadded.token.customerName, 'Jane Doe Student', 'Customer name must be trimmed');

  // Test 3: Blank whitespace only becomes undefined
  const blankName = '     ';
  const createdBlank = createToken(state, 'examinations', blankName);
  assert.equal(createdBlank.token.customerName, undefined, 'Whitespace-only name must resolve to undefined');
});

test('QA-22: Security & Privacy - Storage keys are namespaced and isolated', () => {
  assert.equal(QUEUELESS_STORAGE_KEY, 'queueless_state_v1');
  assert.equal(SESSION_TOKEN_KEY, 'queueless_active_token_id_v1');
  assert.equal(SYNC_CHANNEL_NAME, 'queueless_queue_sync_v1');
});

// ============================================================================
// SUITE 6: END-TO-END FLOW VALIDATION & MULTI-SERVICE WORKFLOWS
// ============================================================================

test('QA-23: End-to-End Workflow - Complete lifecycle of customer from issuance to completed service with analytics update', () => {
  const mockStorage = createMockStorage();
  let state = createInitialState();

  // 1. Initial State: No tokens, Stage A fallback active
  const initialAnalytics = calculateRollingAverage('admissions', state);
  assert.equal(initialAnalytics.isUsingFallback, true);
  assert.equal(initialAnalytics.effectiveDurationMinutes, 5); // Admissions baseline

  // 2. Customer issues token
  const issueRes = issueCustomerToken({
    state,
    serviceId: 'admissions',
    customerName: 'Samira K.',
    storage: mockStorage,
    timestamp: 1000000
  });
  assert.equal(issueRes.success, true);
  state = issueRes.state;
  const token = issueRes.token;

  // Active token held in session
  assert.equal(mockStorage.getItem(SESSION_TOKEN_KEY), token.id);
  assert.equal(token.tokenNumber, 'ADM-001');

  // 3. Customer tracks position - first in line, counter vacant -> 0 min (Ready now)
  const track1 = getQueueMetrics(token.id, state);
  assert.equal(track1.isReadyNow, true);
  assert.equal(track1.position, 1);
  assert.equal(track1.waitingAhead, 0);

  // 4. Admin calls customer to counter at t=1000000 + 60,000 (1 min later)
  const callRes = callNextToken({
    state,
    serviceId: 'admissions',
    storage: mockStorage,
    timestamp: 1060000
  });
  assert.equal(callRes.success, true);
  state = callRes.state;

  // 5. Customer tracks active serving status
  const track2 = getQueueMetrics(token.id, state);
  assert.equal(track2.isServing, true);
  assert.equal(track2.status, TOKEN_STATUS.SERVING);
  assert.equal(track2.displayText, 'At Counter');

  // 6. Admin completes transaction at t=1060000 + 180,000 (3.0 min service duration)
  const compRes = completeServingToken({
    state,
    serviceId: 'admissions',
    storage: mockStorage,
    timestamp: 1240000
  });
  assert.equal(compRes.success, true);
  state = compRes.state;

  // 7. Completed token status verified
  const completedToken = state.tokens.find((t) => t.id === token.id);
  assert.equal(completedToken.status, TOKEN_STATUS.COMPLETED);
  assert.equal(completedToken.calledAt, 1060000);
  assert.equal(completedToken.completedAt, 1240000);

  // 8. Stage B Analytics now immediately reflects the completed 3-minute transaction!
  const updatedAnalytics = calculateRollingAverage('admissions', state);
  assert.equal(updatedAnalytics.isUsingFallback, false);
  assert.equal(updatedAnalytics.sampleCount, 1);
  assert.equal(updatedAnalytics.rollingAverageMinutes, 3.0);
  assert.equal(updatedAnalytics.dataSufficiency, DATA_SUFFICIENCY.INSUFFICIENT_HISTORY);

  // 9. Customer dismisses session, session token cleared
  mockStorage.removeItem(SESSION_TOKEN_KEY);
  assert.equal(getActiveSessionToken(state, mockStorage.getItem(SESSION_TOKEN_KEY)), null);
});

test('QA-24: End-to-End Workflow - Skipped customer re-queue and subsequent completion flow', () => {
  const mockStorage = createMockStorage();
  let state = createInitialState();

  // Issue Cust 1
  const t1 = issueCustomerToken({ state, serviceId: 'finance', storage: mockStorage, timestamp: 1000 }).token;
  state = loadQueueState(mockStorage).state;

  // Issue Cust 2
  const t2 = createToken(state, 'finance', 'Cust 2', 2000).token;
  state = createToken(state, 'finance', 'Cust 2', 2000).state;

  // Call Cust 1
  state = callNextToken({ state, serviceId: 'finance', storage: mockStorage, timestamp: 3000 }).state;

  // Skip Cust 1 (no-show)
  const skipRes = skipServingToken({ state, serviceId: 'finance', storage: mockStorage, timestamp: 4000 });
  assert.equal(skipRes.success, true);
  state = skipRes.state;

  // Cust 1 is SKIPPED: must NOT count toward historical analytics
  const analyticsAfterSkip = calculateRollingAverage('finance', state);
  assert.equal(analyticsAfterSkip.sampleCount, 0, 'Skipped customer must NOT contribute to sample count');

  // Cust 2 can now be called
  const callCust2 = callNextToken({ state, serviceId: 'finance', storage: mockStorage, timestamp: 5000 });
  assert.equal(callCust2.success, true);
  state = callCust2.state;

  // Re-queue Cust 1
  const requeueRes = requeueSkippedToken({ state, tokenId: t1.id, storage: mockStorage, timestamp: 6000 });
  assert.equal(requeueRes.success, true);
  state = requeueRes.state;

  // Cust 1 is now waiting behind Cust 2 (who is currently serving)
  const cust1Metrics = getQueueMetrics(t1.id, state);
  assert.equal(cust1Metrics.status, TOKEN_STATUS.WAITING);
  assert.equal(cust1Metrics.waitingAhead, 0, '0 customers waiting ahead in WAITING queue');

  // Complete Cust 2 (5 min duration)
  state = completeServingToken({ state, serviceId: 'finance', storage: mockStorage, timestamp: 5000 + 300000 }).state;

  // Call re-queued Cust 1
  const callRequeued = callNextToken({ state, serviceId: 'finance', storage: mockStorage, timestamp: 8000 });
  assert.equal(callRequeued.success, true);
  state = callRequeued.state;

  assert.equal(state.tokens.find((t) => t.id === t1.id).status, TOKEN_STATUS.SERVING);
});

test('QA-25: Multi-Service Isolation - Simultaneous token issuance and admin operations do not interfere across counters', () => {
  const mockStorage = createMockStorage();
  let state = createInitialState();

  // 3 services issue tokens simultaneously
  state = createToken(state, 'admissions', 'Adm Cust', 100).state;
  state = createToken(state, 'finance', 'Fin Cust', 200).state;
  state = createToken(state, 'examinations', 'Exm Cust', 300).state;

  assert.equal(state.sequenceCounters.admissions, 1);
  assert.equal(state.sequenceCounters.finance, 1);
  assert.equal(state.sequenceCounters.examinations, 1);

  // Pause Admissions only
  state = toggleServicePause({ state, serviceId: 'admissions', storage: mockStorage }).state;
  assert.equal(state.serviceStatuses.admissions, SERVICE_STATUS.PAUSED);
  assert.equal(state.serviceStatuses.finance, SERVICE_STATUS.ACTIVE);
  assert.equal(state.serviceStatuses.examinations, SERVICE_STATUS.ACTIVE);

  // New issuance for Admissions is blocked
  const blockedAdm = issueCustomerToken({ state, serviceId: 'admissions', storage: mockStorage });
  assert.equal(blockedAdm.success, false);
  assert.equal(blockedAdm.code, 'SERVICE_PAUSED');

  // Issuance for Finance and Examinations still succeeds!
  const okFin = createToken(state, 'finance', 'Fin Cust 2', 400);
  assert.equal(okFin.token.tokenNumber, 'FIN-002');
  state = okFin.state;

  const okExm = createToken(state, 'examinations', 'Exm Cust 2', 500);
  assert.equal(okExm.token.tokenNumber, 'EXM-002');
  state = okExm.state;

  assert.equal(state.sequenceCounters.finance, 2);
  assert.equal(state.sequenceCounters.examinations, 2);
  assert.equal(state.sequenceCounters.admissions, 1);
});

test('QA-26: Zero-Wait Semantics - Counter ready vs next in line displays correct status wording', () => {
  let state = createInitialState();

  // Cust 1 joins empty queue
  state = createToken(state, 'examinations', 'Cust 1', 100).state;
  const id1 = state.tokens[0].id;

  const est1 = calculateStageBWaitTime(id1, state);
  assert.equal(est1.isReadyNow, true);
  assert.equal(est1.displayText, '0 min (Ready now)');
  assert.ok(est1.statusWording.includes('Counter is ready to call you'));

  // Cust 2 joins behind Cust 1
  state = createToken(state, 'examinations', 'Cust 2', 200).state;
  const id2 = state.tokens[1].id;

  const est2 = calculateStageBWaitTime(id2, state);
  assert.equal(est2.isReadyNow, false);
  assert.equal(est2.estimatedMinutes, 6); // 1 ahead * 6 min baseline
  assert.ok(est2.statusWording.includes('1 waiting token ahead of you'));
});

test('QA-27: Schema Invariant - validateQueueState rigorously verifies complete valid structure', () => {
  const validState = createInitialState();
  assert.equal(validateQueueState(validState).isValid, true);

  // Null or primitive state
  assert.equal(validateQueueState(null).isValid, false);
  assert.equal(validateQueueState('string').isValid, false);
  assert.equal(validateQueueState({}).isValid, false);

  // Missing version
  assert.equal(validateQueueState({ ...validState, version: -1 }).isValid, false);
  assert.equal(validateQueueState({ ...validState, version: 'one' }).isValid, false);

  // Missing sequenceCounters
  assert.equal(validateQueueState({ ...validState, sequenceCounters: null }).isValid, false);

  // Missing serviceStatuses
  assert.equal(validateQueueState({ ...validState, serviceStatuses: null }).isValid, false);

  // Tokens not array
  assert.equal(validateQueueState({ ...validState, tokens: null }).isValid, false);
});

