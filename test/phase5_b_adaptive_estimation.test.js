import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialState,
  TOKEN_STATUS,
  createToken,
  applyTransition
} from '../src/utils/queueModel.js';

import {
  APPROVED_SERVICES
} from '../src/utils/services.js';

import {
  saveQueueState,
  loadQueueState,
  getStorageEngine
} from '../src/utils/storage.js';

import {
  issueCustomerToken
} from '../src/utils/tokenIssuance.js';

import {
  callNextToken,
  completeServingToken,
  skipServingToken,
  requeueSkippedToken,
  resetServiceQueue,
  resetAllQueuesAction
} from '../src/utils/adminDispatch.js';

import {
  calculateQueuePosition,
  calculateStageAWaitTime,
  calculateStageBWaitTime,
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

/**
 * Helper to construct a completed token with explicit timestamps
 */
function createCompletedToken({
  id,
  tokenNumber,
  serviceId,
  calledAt,
  completedAt,
  status = TOKEN_STATUS.COMPLETED
}) {
  return {
    id,
    tokenNumber,
    serviceId,
    serviceName: APPROVED_SERVICES.find((s) => s.id === serviceId)?.name || serviceId,
    status,
    createdAt: (calledAt || 1000) - 1000,
    calledAt,
    completedAt,
    skippedAt: null,
    estimatedWaitMinutes: 5,
    requeueCount: 0
  };
}

/* ========================================================================
 * PHASE 5B: 20 COMPREHENSIVE AUTOMATED TESTS
 * ======================================================================== */

test('1. No-history baseline fallback uses approved service baseline', () => {
  const state = createInitialState();

  // Test Admissions (baseline: 5 min)
  const admAnalytics = calculateRollingAverage('admissions', state.tokens);
  assert.equal(admAnalytics.sampleCount, 0);
  assert.equal(admAnalytics.rollingAverageMinutes, null);
  assert.equal(admAnalytics.effectiveDurationMinutes, 5);
  assert.equal(admAnalytics.baselineMinutes, 5);
  assert.equal(admAnalytics.isUsingFallback, true);
  assert.equal(admAnalytics.estimationMethod, ESTIMATION_METHOD.STAGE_A_BASELINE);
  assert.equal(admAnalytics.dataSufficiency, DATA_SUFFICIENCY.NO_HISTORY);

  // Test Finance (baseline: 3 min)
  const finAnalytics = calculateRollingAverage('finance', state.tokens);
  assert.equal(finAnalytics.effectiveDurationMinutes, 3);
  assert.equal(finAnalytics.isUsingFallback, true);

  // Test Examinations (baseline: 6 min)
  const exmAnalytics = calculateRollingAverage('examinations', state.tokens);
  assert.equal(exmAnalytics.effectiveDurationMinutes, 6);
  assert.equal(exmAnalytics.isUsingFallback, true);
});

test('2. One-sample average calculates correct duration and reports INSUFFICIENT_HISTORY', () => {
  // 1 completed token with 4.0 minutes service duration
  const calledAt = 1000;
  const completedAt = calledAt + (4 * 60000); // 4 minutes
  const t1 = createCompletedToken({
    id: 'tok_1',
    tokenNumber: 'FIN-001',
    serviceId: 'finance',
    calledAt,
    completedAt
  });

  const analytics = calculateRollingAverage('finance', [t1]);
  assert.equal(analytics.sampleCount, 1);
  assert.equal(analytics.rollingAverageMinutes, 4.0);
  assert.equal(analytics.effectiveDurationMinutes, 4.0);
  assert.equal(analytics.baselineMinutes, 3);
  assert.equal(analytics.isUsingFallback, false);
  assert.equal(analytics.estimationMethod, ESTIMATION_METHOD.STAGE_B_ROLLING_AVERAGE);
  assert.equal(analytics.dataSufficiency, DATA_SUFFICIENCY.INSUFFICIENT_HISTORY);
  assert.deepEqual(analytics.recentDurations, [4.0]);
});

test('3. Three-sample average calculates arithmetic mean across available samples', () => {
  // 3 completed tokens in Admissions with durations: 3m, 5m, 7m -> mean = 5.0m
  const t1 = createCompletedToken({ id: 't1', tokenNumber: 'ADM-001', serviceId: 'admissions', calledAt: 1000, completedAt: 1000 + 3 * 60000 });
  const t2 = createCompletedToken({ id: 't2', tokenNumber: 'ADM-002', serviceId: 'admissions', calledAt: 2000, completedAt: 2000 + 5 * 60000 });
  const t3 = createCompletedToken({ id: 't3', tokenNumber: 'ADM-003', serviceId: 'admissions', calledAt: 3000, completedAt: 3000 + 7 * 60000 });

  const analytics = calculateRollingAverage('admissions', [t1, t2, t3]);
  assert.equal(analytics.sampleCount, 3);
  assert.equal(analytics.rollingAverageMinutes, 5.0);
  assert.equal(analytics.effectiveDurationMinutes, 5.0);
  assert.equal(analytics.dataSufficiency, DATA_SUFFICIENCY.INSUFFICIENT_HISTORY);
});

test('4. Five-sample average reaches SUFFICIENT_HISTORY', () => {
  // 5 completed tokens in Admissions: durations 2m, 3m, 4m, 5m, 6m -> mean = 4.0m
  const tokens = [2, 3, 4, 5, 6].map((dur, i) =>
    createCompletedToken({
      id: `tok_${i}`,
      tokenNumber: `ADM-00${i + 1}`,
      serviceId: 'admissions',
      calledAt: i * 10000 + 1000,
      completedAt: i * 10000 + 1000 + dur * 60000
    })
  );

  const analytics = calculateRollingAverage('admissions', tokens);
  assert.equal(analytics.sampleCount, 5);
  assert.equal(analytics.rollingAverageMinutes, 4.0);
  assert.equal(analytics.dataSufficiency, DATA_SUFFICIENCY.SUFFICIENT_HISTORY);
  assert.equal(analytics.isUsingFallback, false);
});

test('5. More-than-five sample rolling window caps at sample window size 5', () => {
  // 8 completed tokens
  const tokens = [2, 3, 4, 5, 6, 7, 8, 9].map((dur, i) =>
    createCompletedToken({
      id: `tok_${i}`,
      tokenNumber: `ADM-00${i + 1}`,
      serviceId: 'admissions',
      calledAt: (i + 1) * 10000,
      completedAt: (i + 1) * 10000 + dur * 60000
    })
  );

  const analytics = calculateRollingAverage('admissions', tokens);
  assert.equal(analytics.sampleCount, 5); // Window clamped to 5
  assert.equal(analytics.totalValidTransactions, 8);
  assert.equal(analytics.sampleWindow, 5);
  assert.equal(analytics.dataSufficiency, DATA_SUFFICIENCY.SUFFICIENT_HISTORY);
});

test('6. Newest five completed transactions are selected based on completedAt descending', () => {
  // Create 7 tokens with increasing completedAt timestamps
  // Durations: [10m, 10m, 2m, 2m, 2m, 2m, 2m]
  // Oldest two (at completedAt 100000, 200000) have duration 10 min.
  // Newest five (at completedAt 300000..700000) have duration 2 min.
  const old1 = createCompletedToken({ id: 'old1', tokenNumber: 'ADM-001', serviceId: 'admissions', calledAt: 10000, completedAt: 100000 }); // (100000-10000)/60000 = 1.5m -> let's make explicit:
  old1.calledAt = 100000 - (10 * 60000);
  old1.completedAt = 100000; // 10 min duration

  const old2 = createCompletedToken({ id: 'old2', tokenNumber: 'ADM-002', serviceId: 'admissions', calledAt: 200000 - (10 * 60000), completedAt: 200000 }); // 10 min

  const recent1 = createCompletedToken({ id: 'r1', tokenNumber: 'ADM-003', serviceId: 'admissions', calledAt: 300000 - (2 * 60000), completedAt: 300000 }); // 2 min
  const recent2 = createCompletedToken({ id: 'r2', tokenNumber: 'ADM-004', serviceId: 'admissions', calledAt: 400000 - (2 * 60000), completedAt: 400000 }); // 2 min
  const recent3 = createCompletedToken({ id: 'r3', tokenNumber: 'ADM-005', serviceId: 'admissions', calledAt: 500000 - (2 * 60000), completedAt: 500000 }); // 2 min
  const recent4 = createCompletedToken({ id: 'r4', tokenNumber: 'ADM-006', serviceId: 'admissions', calledAt: 600000 - (2 * 60000), completedAt: 600000 }); // 2 min
  const recent5 = createCompletedToken({ id: 'r5', tokenNumber: 'ADM-007', serviceId: 'admissions', calledAt: 700000 - (2 * 60000), completedAt: 700000 }); // 2 min

  // Pass tokens out of order
  const tokens = [recent3, old1, recent1, recent5, old2, recent2, recent4];

  const analytics = calculateRollingAverage('admissions', tokens);
  // If newest 5 are selected: [2, 2, 2, 2, 2] -> average = 2.0 min
  // If oldest were included: average would be (10 + 10 + 2 + 2 + 2)/5 = 5.2 min
  assert.equal(analytics.rollingAverageMinutes, 2.0);
  assert.deepEqual(analytics.recentDurations, [2, 2, 2, 2, 2]);
  assert.equal(analytics.recentSamples[0].tokenNumber, 'ADM-007'); // Newest first
});

test('7. Skipped transactions are strictly excluded from rolling average', () => {
  const comp1 = createCompletedToken({ id: 'c1', tokenNumber: 'FIN-001', serviceId: 'finance', calledAt: 1000, completedAt: 1000 + 4 * 60000 });
  
  // Skipped token (absentee customer)
  const skippedToken = {
    id: 's1',
    tokenNumber: 'FIN-002',
    serviceId: 'finance',
    status: TOKEN_STATUS.SKIPPED,
    calledAt: 2000,
    completedAt: null,
    skippedAt: 2000 + 1 * 60000
  };

  assert.equal(isEligibleCompletedToken(skippedToken), false);

  const analytics = calculateRollingAverage('finance', [comp1, skippedToken]);
  assert.equal(analytics.sampleCount, 1);
  assert.equal(analytics.rollingAverageMinutes, 4.0);
});

test('8. Cancelled transactions are excluded from rolling average', () => {
  const comp1 = createCompletedToken({ id: 'c1', tokenNumber: 'EXM-001', serviceId: 'examinations', calledAt: 1000, completedAt: 1000 + 5 * 60000 });

  const cancelledToken = {
    id: 'canc1',
    tokenNumber: 'EXM-002',
    serviceId: 'examinations',
    status: TOKEN_STATUS.CANCELLED,
    calledAt: null,
    completedAt: 2000
  };

  assert.equal(isEligibleCompletedToken(cancelledToken), false);

  const analytics = calculateRollingAverage('examinations', [comp1, cancelledToken]);
  assert.equal(analytics.sampleCount, 1);
  assert.equal(analytics.rollingAverageMinutes, 5.0);
});

test('9. Invalid timestamps (null, non-numeric, NaN) are excluded', () => {
  const bad1 = createCompletedToken({ id: 'b1', tokenNumber: 'ADM-001', serviceId: 'admissions', calledAt: null, completedAt: 5000 });
  const bad2 = createCompletedToken({ id: 'b2', tokenNumber: 'ADM-002', serviceId: 'admissions', calledAt: 5000, completedAt: undefined });
  const bad3 = createCompletedToken({ id: 'b3', tokenNumber: 'ADM-003', serviceId: 'admissions', calledAt: NaN, completedAt: 10000 });
  const bad4 = createCompletedToken({ id: 'b4', tokenNumber: 'ADM-004', serviceId: 'admissions', calledAt: 'invalid', completedAt: 10000 });

  assert.equal(isEligibleCompletedToken(bad1), false);
  assert.equal(isEligibleCompletedToken(bad2), false);
  assert.equal(isEligibleCompletedToken(bad3), false);
  assert.equal(isEligibleCompletedToken(bad4), false);

  const analytics = calculateRollingAverage('admissions', [bad1, bad2, bad3, bad4]);
  assert.equal(analytics.sampleCount, 0);
  assert.equal(analytics.isUsingFallback, true);
  assert.equal(analytics.effectiveDurationMinutes, 5); // baseline
});

test('10. Negative or zero durations (completedAt <= calledAt) are excluded', () => {
  // completedAt < calledAt
  const neg = createCompletedToken({ id: 'neg', tokenNumber: 'ADM-001', serviceId: 'admissions', calledAt: 10000, completedAt: 5000 });
  // completedAt == calledAt
  const zero = createCompletedToken({ id: 'zero', tokenNumber: 'ADM-002', serviceId: 'admissions', calledAt: 10000, completedAt: 10000 });

  assert.equal(isEligibleCompletedToken(neg), false);
  assert.equal(isEligibleCompletedToken(zero), false);

  const analytics = calculateRollingAverage('admissions', [neg, zero]);
  assert.equal(analytics.sampleCount, 0);
  assert.equal(analytics.isUsingFallback, true);
});

test('11. Durations below one minute are clamped to 1.0 minute', () => {
  // Duration: 15 seconds = 0.25 minutes
  const quick = createCompletedToken({
    id: 'quick',
    tokenNumber: 'FIN-001',
    serviceId: 'finance',
    calledAt: 1000,
    completedAt: 1000 + 15000
  });

  const duration = extractTokenDurationMinutes(quick);
  assert.equal(duration, MIN_DURATION_CLAMP_MINUTES); // Clamped to 1.0

  const analytics = calculateRollingAverage('finance', [quick]);
  assert.equal(analytics.rollingAverageMinutes, 1.0);
});

test('12. Durations above twenty minutes are clamped to 20.0 minutes', () => {
  // Duration: 45 minutes
  const long = createCompletedToken({
    id: 'long',
    tokenNumber: 'FIN-001',
    serviceId: 'finance',
    calledAt: 1000,
    completedAt: 1000 + (45 * 60000)
  });

  const duration = extractTokenDurationMinutes(long);
  assert.equal(duration, MAX_DURATION_CLAMP_MINUTES); // Clamped to 20.0

  const analytics = calculateRollingAverage('finance', [long]);
  assert.equal(analytics.rollingAverageMinutes, 20.0);
});

test('13. Service isolation is preserved across counters', () => {
  // 3 completed tokens in Admissions (duration 8m each)
  const admTokens = [1, 2, 3].map((i) =>
    createCompletedToken({ id: `a_${i}`, tokenNumber: `ADM-00${i}`, serviceId: 'admissions', calledAt: 1000, completedAt: 1000 + 8 * 60000 })
  );

  // 1 completed token in Finance (duration 2m)
  const finTokens = [
    createCompletedToken({ id: 'f_1', tokenNumber: 'FIN-001', serviceId: 'finance', calledAt: 1000, completedAt: 1000 + 2 * 60000 })
  ];

  // Examinations has 0 completed tokens
  const allTokens = [...admTokens, ...finTokens];

  const allAnalytics = getAllServicesAnalytics(allTokens);

  // Admissions should have 8.0 min rolling average
  assert.equal(allAnalytics.admissions.sampleCount, 3);
  assert.equal(allAnalytics.admissions.rollingAverageMinutes, 8.0);
  assert.equal(allAnalytics.admissions.isUsingFallback, false);

  // Finance should have 2.0 min rolling average
  assert.equal(allAnalytics.finance.sampleCount, 1);
  assert.equal(allAnalytics.finance.rollingAverageMinutes, 2.0);
  assert.equal(allAnalytics.finance.isUsingFallback, false);

  // Examinations should fall back to baseline 6 min
  assert.equal(allAnalytics.examinations.sampleCount, 0);
  assert.equal(allAnalytics.examinations.rollingAverageMinutes, null);
  assert.equal(allAnalytics.examinations.effectiveDurationMinutes, 6);
  assert.equal(allAnalytics.examinations.isUsingFallback, true);
});

test('14. Current serving duration is not double-counted in Stage B estimation', () => {
  let state = createInitialState();

  // Seed 2 completed tokens in Admissions with 4.0 min duration each
  const comp1 = createCompletedToken({ id: 'c1', tokenNumber: 'ADM-001', serviceId: 'admissions', calledAt: 1000, completedAt: 1000 + 4 * 60000 });
  const comp2 = createCompletedToken({ id: 'c2', tokenNumber: 'ADM-002', serviceId: 'admissions', calledAt: 2000, completedAt: 2000 + 4 * 60000 });
  state.tokens.push(comp1, comp2);

  // ADM-003 is currently SERVING, called 1 minute ago (currentTime = 60000 + 100000)
  const servingToken = {
    ...createToken(state, 'admissions', 'ServingCust', 100000).token,
    status: TOKEN_STATUS.SERVING,
    calledAt: 100000
  };
  state.tokens.push(servingToken);

  // ADM-004 is WAITING (position #1, N_ahead = 0)
  const waitingToken = {
    ...createToken(state, 'admissions', 'WaitingCust', 101000).token,
    status: TOKEN_STATUS.WAITING
  };
  state.tokens.push(waitingToken);

  const currentTime = 100000 + (1 * 60000); // 1 minute elapsed since call
  // Effective duration = 4.0 min (rolling average)
  // Remaining current service = 4.0 - 1.0 = 3.0 min
  // Estimated wait for ADM-004 = 3.0 + (0 * 4.0) = 3 min
  const estimate = calculateStageBWaitTime(waitingToken, state, currentTime);

  assert.equal(estimate.estimatedServiceDuration, 4.0);
  assert.equal(estimate.remainingCurrentService, 3.0);
  assert.equal(estimate.estimatedMinutes, 3);
  assert.equal(estimate.estimationMethod, ESTIMATION_METHOD.STAGE_B_ROLLING_AVERAGE);
});

test('15. Queue-position calculations remain correct and consistent with Phase 4A', () => {
  let state = createInitialState();
  const t1 = { ...createToken(state, 'finance', 'F1', 1000).token, status: TOKEN_STATUS.WAITING };
  const t2 = { ...createToken(state, 'finance', 'F2', 2000).token, status: TOKEN_STATUS.WAITING };
  state.tokens.push(t1, t2);

  const p1 = calculateQueuePosition(t1.id, state);
  assert.equal(p1.position, 1);
  assert.equal(p1.waitingAhead, 0);

  const p2 = calculateQueuePosition(t2.id, state);
  assert.equal(p2.position, 2);
  assert.equal(p2.waitingAhead, 1);
});

test('16. Zero-wait semantics remain correct with Stage B adaptive durations', () => {
  let state = createInitialState();

  // Add a completed token with 8.0 min duration
  const comp = createCompletedToken({ id: 'c1', tokenNumber: 'EXM-001', serviceId: 'examinations', calledAt: 1000, completedAt: 1000 + 8 * 60000 });
  state.tokens.push(comp);

  // Counter is vacant, customer joins line (N_ahead = 0)
  const tWait = { ...createToken(state, 'examinations', 'Alice', 2000).token, status: TOKEN_STATUS.WAITING };
  state.tokens.push(tWait);

  const estimate = calculateStageBWaitTime(tWait, state);
  assert.equal(estimate.estimatedServiceDuration, 8.0);
  assert.equal(estimate.estimatedMinutes, 0); // Ready now!
  assert.equal(estimate.displayText, '0 min (Ready now)');
  assert.equal(estimate.isReadyNow, true);
  assert.equal(estimate.statusWording, 'You are next in line — Counter is ready to call you');
});

test('17. Stage A fallback produces identical result when history is empty', () => {
  let state = createInitialState();
  const t1 = { ...createToken(state, 'admissions', 'A1', 1000).token, status: TOKEN_STATUS.WAITING };
  const t2 = { ...createToken(state, 'admissions', 'A2', 2000).token, status: TOKEN_STATUS.WAITING };
  state.tokens.push(t1, t2);

  const stageA = calculateStageAWaitTime(t2, state);
  const stageB = calculateStageBWaitTime(t2, state);

  assert.equal(stageB.isUsingFallback, true);
  assert.equal(stageB.estimationMethod, ESTIMATION_METHOD.STAGE_A_BASELINE);
  assert.equal(stageB.estimatedMinutes, stageA.estimatedMinutes);
  assert.equal(stageB.displayText, stageA.displayText);
  assert.equal(stageB.statusWording, stageA.statusWording);
});

test('18. Estimates update dynamically after token completion', () => {
  const storage = createMockStorage();
  let state = createInitialState();

  // Step 1: Issue 2 tokens in Admissions
  state = issueCustomerToken({ state, serviceId: 'admissions', customerName: 'Alice', storage, timestamp: 1000 }).state;
  state = issueCustomerToken({ state, serviceId: 'admissions', customerName: 'Bob', storage, timestamp: 2000 }).state;

  const tAlice = state.tokens[0];
  const tBob = state.tokens[1];

  // At this stage, 0 completed tokens -> fallback to baseline (5 min)
  let bobEst = calculateStageBWaitTime(tBob, state);
  assert.equal(bobEst.isUsingFallback, true);
  assert.equal(bobEst.estimatedMinutes, 5); // 1 ahead * 5m baseline

  // Step 2: Call Alice at timestamp 3000
  state = callNextToken({ state, serviceId: 'admissions', storage, timestamp: 3000 }).state;

  // Step 3: Complete Alice at timestamp 3000 + (2.5 * 60000) = 153000 (2.5 min duration)
  const completeTime = 3000 + (2.5 * 60000);
  state = completeServingToken({ state, serviceId: 'admissions', storage, timestamp: completeTime }).state;

  // Step 4: Bob is now head of queue, counter is vacant -> wait is 0 min (Ready now)
  bobEst = calculateStageBWaitTime(tBob, state);
  assert.equal(bobEst.isUsingFallback, false);
  assert.equal(bobEst.rollingAverageMinutes, 2.5);
  assert.equal(bobEst.estimatedMinutes, 0); // Ready now

  // Step 5: Issue a third token Charlie (N_ahead = 1 behind Bob)
  state = issueCustomerToken({ state, serviceId: 'admissions', customerName: 'Charlie', storage, timestamp: completeTime + 1000 }).state;
  const tCharlie = state.tokens[state.tokens.length - 1];

  const charlieEst = calculateStageBWaitTime(tCharlie, state);
  // Charlie has 1 ahead (Bob). Estimated service duration = 2.5 min.
  // Wait = 1 * 2.5 = 2.5 min -> rounded to 3 min
  assert.equal(charlieEst.estimatedServiceDuration, 2.5);
  assert.equal(charlieEst.estimatedMinutes, 3);
  assert.equal(charlieEst.sampleCount, 1);
});

test('19. Estimates update after cross-tab synchronization', () => {
  const storage = createMockStorage();
  const bus = new MockBroadcastChannelBus();
  const chTabA = bus.createChannel();
  const chTabB = bus.createChannel();

  // Tab A (Customer viewing tracker for FIN-002)
  let tabAState = createInitialState();
  // Issue FIN-001 and FIN-002
  tabAState = issueCustomerToken({ state: tabAState, serviceId: 'finance', customerName: 'F1', storage, timestamp: 1000 }).state;
  tabAState = issueCustomerToken({ state: tabAState, serviceId: 'finance', customerName: 'F2', storage, timestamp: 2000 }).state;

  const tF2 = tabAState.tokens[1];

  let tabBState = tabAState;

  // Tab A subscribes to cross-tab sync
  const teardown = subscribeCrossTabSync({
    originId: 'tab_a_customer',
    customBroadcastChannel: chTabA,
    onSyncEvent: () => {
      const loaded = loadQueueState(storage);
      if (loaded.state && loaded.state.version > tabAState.version) {
        tabAState = loaded.state;
      }
    }
  });

  // Initially in Tab A: 0 completed tokens, uses 3 min baseline
  let f2EstimateTabA = calculateStageBWaitTime(tF2, tabAState);
  assert.equal(f2EstimateTabA.isUsingFallback, true);
  assert.equal(f2EstimateTabA.estimatedMinutes, 3); // 1 * 3m baseline

  // In Tab B (Admin): Call and complete FIN-001 with 7.0 minutes duration
  tabBState = callNextToken({ state: tabBState, serviceId: 'finance', storage, timestamp: 3000 }).state;
  const finishTime = 3000 + (7 * 60000);
  tabBState = completeServingToken({ state: tabBState, serviceId: 'finance', storage, timestamp: finishTime }).state;

  // Tab B broadcasts completion
  broadcastSyncEvent({
    type: SYNC_EVENTS.TOKEN_COMPLETED,
    version: tabBState.version,
    originId: 'tab_b_admin',
    metadata: { serviceId: 'finance' },
    channel: chTabB
  });

  // Tab A has synchronized from storage
  assert.equal(tabAState.version, tabBState.version);

  // Tab A's duration analytics now reflects the 7.0 min completed token!
  const analyticsTabA = calculateRollingAverage('finance', tabAState);
  assert.equal(analyticsTabA.sampleCount, 1);
  assert.equal(analyticsTabA.rollingAverageMinutes, 7.0);
  assert.equal(analyticsTabA.isUsingFallback, false);

  teardown();
  chTabA.close();
  chTabB.close();
});

test('20. Resetting a service cleanly clears historical analytics for that service', () => {
  const storage = createMockStorage();
  let state = createInitialState();

  // Add 3 completed tokens in Admissions (duration 5 min each)
  const c1 = createCompletedToken({ id: 'c1', tokenNumber: 'ADM-001', serviceId: 'admissions', calledAt: 1000, completedAt: 1000 + 5 * 60000 });
  const c2 = createCompletedToken({ id: 'c2', tokenNumber: 'ADM-002', serviceId: 'admissions', calledAt: 2000, completedAt: 2000 + 5 * 60000 });
  const c3 = createCompletedToken({ id: 'c3', tokenNumber: 'ADM-003', serviceId: 'admissions', calledAt: 3000, completedAt: 3000 + 5 * 60000 });

  // Add 1 completed token in Finance
  const f1 = createCompletedToken({ id: 'f1', tokenNumber: 'FIN-001', serviceId: 'finance', calledAt: 1000, completedAt: 1000 + 2 * 60000 });

  state.tokens.push(c1, c2, c3, f1);
  saveQueueState(state, storage);

  // Before reset: Admissions has 3 samples
  let admAnalytics = calculateRollingAverage('admissions', state);
  assert.equal(admAnalytics.sampleCount, 3);
  assert.equal(admAnalytics.isUsingFallback, false);

  // Admin resets Admissions queue
  const resetRes = resetServiceQueue({ state, serviceId: 'admissions', storage, timestamp: 99999 });
  assert.equal(resetRes.success, true);
  state = resetRes.state;

  // After reset: Admissions tokens are cleared -> historical samples return to 0, falls back to baseline
  admAnalytics = calculateRollingAverage('admissions', state);
  assert.equal(admAnalytics.sampleCount, 0);
  assert.equal(admAnalytics.isUsingFallback, true);
  assert.equal(admAnalytics.effectiveDurationMinutes, 5); // Admissions baseline

  // Finance tokens remain untouched
  const finAnalytics = calculateRollingAverage('finance', state);
  assert.equal(finAnalytics.sampleCount, 1);
  assert.equal(finAnalytics.rollingAverageMinutes, 2.0);
});

