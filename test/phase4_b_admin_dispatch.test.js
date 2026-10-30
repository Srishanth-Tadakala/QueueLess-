import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialState,
  TOKEN_STATUS,
  SERVICE_STATUS,
  applyTransition
} from '../src/utils/queueModel.js';

import {
  issueCustomerToken
} from '../src/utils/tokenIssuance.js';

import {
  getServiceQueue,
  calculateQueuePosition,
  calculateStageAWaitTime
} from '../src/utils/estimationEngine.js';

import {
  callNextToken,
  completeServingToken,
  skipServingToken,
  requeueSkippedToken,
  toggleServicePause,
  resetServiceQueue,
  resetAllQueuesAction
} from '../src/utils/adminDispatch.js';

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

test('1. Calling Next selects the first eligible token in FIFO order', () => {
  const storage = createMockStorage();
  let state = createInitialState();

  const r1 = issueCustomerToken({ state, serviceId: 'admissions', customerName: 'Alice', timestamp: 1000, storage });
  const r2 = issueCustomerToken({ state: r1.state, serviceId: 'admissions', customerName: 'Bob', timestamp: 2000, storage });
  state = r2.state;

  const dispatchRes = callNextToken({ state, serviceId: 'admissions', storage, timestamp: 3000 });

  assert.equal(dispatchRes.success, true);
  assert.equal(dispatchRes.token.tokenNumber, 'ADM-001');
  assert.equal(dispatchRes.token.status, TOKEN_STATUS.SERVING);
  assert.equal(dispatchRes.token.calledAt, 3000);

  // Bob is still waiting
  const bob = dispatchRes.state.tokens.find((t) => t.customerName === 'Bob');
  assert.equal(bob.status, TOKEN_STATUS.WAITING);
});

test('2. Calling Next with an empty queue is rejected safely', () => {
  const storage = createMockStorage();
  const state = createInitialState();

  const dispatchRes = callNextToken({ state, serviceId: 'finance', storage });

  assert.equal(dispatchRes.success, false);
  assert.equal(dispatchRes.code, 'QUEUE_EMPTY');
  assert.ok(dispatchRes.error.includes('Queue is empty'));
  assert.deepEqual(dispatchRes.state.tokens, []);
});

test('3. Calling Next when a token is already serving is rejected', () => {
  const storage = createMockStorage();
  let state = createInitialState();

  const r1 = issueCustomerToken({ state, serviceId: 'examinations', customerName: 'Alice', timestamp: 1000, storage });
  const r2 = issueCustomerToken({ state: r1.state, serviceId: 'examinations', customerName: 'Bob', timestamp: 2000, storage });
  state = r2.state;

  // Alice is called to SERVING
  const call1 = callNextToken({ state, serviceId: 'examinations', storage, timestamp: 3000 });
  assert.equal(call1.success, true);

  // Attempting to call Bob while Alice is still serving must be rejected
  const call2 = callNextToken({ state: call1.state, serviceId: 'examinations', storage, timestamp: 4000 });
  assert.equal(call2.success, false);
  assert.equal(call2.code, 'COUNTER_OCCUPIED');
  assert.ok(call2.error.includes('Counter is currently SERVING customer EXM-001'));
});

test('4. Completing a serving token records completion correctly and frees counter', () => {
  const storage = createMockStorage();
  let state = createInitialState();

  const r1 = issueCustomerToken({ state, serviceId: 'admissions', customerName: 'Alice', timestamp: 1000, storage });
  const callRes = callNextToken({ state: r1.state, serviceId: 'admissions', storage, timestamp: 2000 });
  state = callRes.state;

  const compRes = completeServingToken({ state, serviceId: 'admissions', storage, timestamp: 5000 });

  assert.equal(compRes.success, true);
  assert.equal(compRes.token.status, TOKEN_STATUS.COMPLETED);
  assert.equal(compRes.token.calledAt, 2000);
  assert.equal(compRes.token.completedAt, 5000);
  assert.equal(compRes.token.skippedAt, null);

  // Counter is now vacant
  const { servingToken } = getServiceQueue(compRes.state, 'admissions');
  assert.equal(servingToken, null);
});

test('5. A completed token cannot be completed again', () => {
  const storage = createMockStorage();
  let state = createInitialState();

  const r1 = issueCustomerToken({ state, serviceId: 'finance', customerName: 'Alice', storage });
  const callRes = callNextToken({ state: r1.state, serviceId: 'finance', storage });
  const compRes = completeServingToken({ state: callRes.state, serviceId: 'finance', storage });
  state = compRes.state;

  // Attempting complete when no token is serving returns NOT_SERVING
  const compRes2 = completeServingToken({ state, serviceId: 'finance', storage });
  assert.equal(compRes2.success, false);
  assert.equal(compRes2.code, 'NOT_SERVING');

  // Attempting direct lifecycle transition on completed token is rejected
  const invalidTransition = applyTransition(state, r1.token.id, TOKEN_STATUS.COMPLETED);
  assert.equal(invalidTransition.success, false);
});

test('6. Skipping a serving token records skippedAt', () => {
  const storage = createMockStorage();
  let state = createInitialState();

  const r1 = issueCustomerToken({ state, serviceId: 'examinations', customerName: 'Alice', timestamp: 1000, storage });
  const callRes = callNextToken({ state: r1.state, serviceId: 'examinations', storage, timestamp: 2000 });
  state = callRes.state;

  const skipRes = skipServingToken({ state, serviceId: 'examinations', storage, timestamp: 4000 });

  assert.equal(skipRes.success, true);
  assert.equal(skipRes.token.status, TOKEN_STATUS.SKIPPED);
  assert.equal(skipRes.token.calledAt, 2000);
  assert.equal(skipRes.token.skippedAt, 4000);
  assert.equal(skipRes.token.completedAt, null);

  // Counter is now vacant
  const { servingToken } = getServiceQueue(skipRes.state, 'examinations');
  assert.equal(servingToken, null);
});

test('7. Skipped tokens do not count as completed', () => {
  const storage = createMockStorage();
  let state = createInitialState();

  const r1 = issueCustomerToken({ state, serviceId: 'finance', customerName: 'Alice', storage });
  const callRes = callNextToken({ state: r1.state, serviceId: 'finance', storage });
  const skipRes = skipServingToken({ state: callRes.state, serviceId: 'finance', storage });

  const token = skipRes.state.tokens.find((t) => t.id === r1.token.id);
  assert.notEqual(token.status, TOKEN_STATUS.COMPLETED);
  assert.equal(token.status, TOKEN_STATUS.SKIPPED);
  assert.equal(token.completedAt, null);
  assert.ok(token.skippedAt !== null);
});

test('8. Re-queuing a skipped token returns it to the FIFO tail with reset timestamps', () => {
  const storage = createMockStorage();
  let state = createInitialState();

  // Alice joins at 1000, Bob joins at 2000
  const r1 = issueCustomerToken({ state, serviceId: 'admissions', customerName: 'Alice', timestamp: 1000, storage });
  const r2 = issueCustomerToken({ state: r1.state, serviceId: 'admissions', customerName: 'Bob', timestamp: 2000, storage });
  state = r2.state;

  // Alice is called at 3000 and skipped at 4000
  const callRes = callNextToken({ state, serviceId: 'admissions', storage, timestamp: 3000 });
  const skipRes = skipServingToken({ state: callRes.state, serviceId: 'admissions', storage, timestamp: 4000 });
  state = skipRes.state;

  // Bob is currently waiting at head of line (position 1)
  const bobPosBefore = calculateQueuePosition(r2.token.id, state);
  assert.equal(bobPosBefore.position, 1);

  // Alice is re-queued at 6000
  const requeueRes = requeueSkippedToken({ state, tokenId: r1.token.id, storage, timestamp: 6000 });
  assert.equal(requeueRes.success, true);
  assert.equal(requeueRes.token.status, TOKEN_STATUS.WAITING);
  assert.equal(requeueRes.token.calledAt, null);
  assert.equal(requeueRes.token.completedAt, null);
  assert.equal(requeueRes.token.skippedAt, null);
  assert.equal(requeueRes.token.createdAt, 6000); // Updated to append to tail!
  assert.equal(requeueRes.token.requeueCount, 1);

  state = requeueRes.state;

  // Bob must remain #1; Alice is now appended to tail as #2
  const bobPosAfter = calculateQueuePosition(r2.token.id, state);
  const alicePosAfter = calculateQueuePosition(r1.token.id, state);

  assert.equal(bobPosAfter.position, 1);
  assert.equal(bobPosAfter.waitingAhead, 0);

  assert.equal(alicePosAfter.position, 2);
  assert.equal(alicePosAfter.waitingAhead, 1);
});

test('9. Re-queuing a non-skipped token is rejected', () => {
  const storage = createMockStorage();
  let state = createInitialState();

  const r1 = issueCustomerToken({ state, serviceId: 'finance', customerName: 'Alice', storage });
  state = r1.state;

  // Token is WAITING, not SKIPPED
  const res = requeueSkippedToken({ state, tokenId: r1.token.id, storage });
  assert.equal(res.success, false);
  assert.equal(res.code, 'INVALID_STATUS');
  assert.ok(res.error.includes('Only SKIPPED tokens can be re-queued'));
});

test('10. Pausing a service prevents new token issuance', () => {
  const storage = createMockStorage();
  let state = createInitialState();

  // Toggle pause for finance
  const pauseRes = toggleServicePause({ state, serviceId: 'finance', storage });
  assert.equal(pauseRes.success, true);
  assert.equal(pauseRes.newStatus, SERVICE_STATUS.PAUSED);
  state = pauseRes.state;

  // New issuance attempt must be rejected
  const issueRes = issueCustomerToken({ state, serviceId: 'finance', customerName: 'Alice', storage });
  assert.equal(issueRes.success, false);
  assert.equal(issueRes.code, 'SERVICE_PAUSED');
  assert.ok(issueRes.error.includes('currently PAUSED'));
});

test('11. Pausing preserves existing waiting tokens', () => {
  const storage = createMockStorage();
  let state = createInitialState();

  const r1 = issueCustomerToken({ state, serviceId: 'admissions', customerName: 'Alice', storage });
  const r2 = issueCustomerToken({ state: r1.state, serviceId: 'admissions', customerName: 'Bob', storage });
  state = r2.state;

  const pauseRes = toggleServicePause({ state, serviceId: 'admissions', storage });
  state = pauseRes.state;

  const { waitingTokens } = getServiceQueue(state, 'admissions');
  assert.equal(waitingTokens.length, 2);
  assert.equal(waitingTokens[0].customerName, 'Alice');
  assert.equal(waitingTokens[1].customerName, 'Bob');
});

test('12. Resuming allows new issuance', () => {
  const storage = createMockStorage();
  let state = createInitialState();

  // Pause
  state = toggleServicePause({ state, serviceId: 'examinations', storage }).state;
  assert.equal(state.serviceStatuses.examinations, SERVICE_STATUS.PAUSED);

  // Resume
  state = toggleServicePause({ state, serviceId: 'examinations', storage }).state;
  assert.equal(state.serviceStatuses.examinations, SERVICE_STATUS.ACTIVE);

  // Now issuance succeeds
  const issueRes = issueCustomerToken({ state, serviceId: 'examinations', customerName: 'Charlie', storage });
  assert.equal(issueRes.success, true);
  assert.equal(issueRes.token.tokenNumber, 'EXM-001');
});

test('13. Reset follows the approved counter and token semantics', () => {
  const storage = createMockStorage();
  let state = createInitialState();

  // Issue 2 admissions tokens, 1 finance token
  state = issueCustomerToken({ state, serviceId: 'admissions', customerName: 'A1', storage }).state;
  state = issueCustomerToken({ state, serviceId: 'admissions', customerName: 'A2', storage }).state;
  state = issueCustomerToken({ state, serviceId: 'finance', customerName: 'F1', storage }).state;

  assert.equal(state.sequenceCounters.admissions, 2);
  assert.equal(state.sequenceCounters.finance, 1);
  assert.equal(state.tokens.length, 3);

  // Reset admissions queue only
  const resetRes = resetServiceQueue({ state, serviceId: 'admissions', storage });
  assert.equal(resetRes.success, true);
  state = resetRes.state;

  // Admissions is reset to 0; finance is untouched
  assert.equal(state.sequenceCounters.admissions, 0);
  assert.equal(state.sequenceCounters.finance, 1);
  assert.equal(state.tokens.length, 1);
  assert.equal(state.tokens[0].serviceId, 'finance');

  // Next admissions token starts at 001, never 000
  const nextAdm = issueCustomerToken({ state, serviceId: 'admissions', customerName: 'NewA', storage });
  assert.equal(nextAdm.token.tokenNumber, 'ADM-001');
});

test('14. Operations on one service do not mutate unrelated services', () => {
  const storage = createMockStorage();
  let state = createInitialState();

  state = issueCustomerToken({ state, serviceId: 'admissions', customerName: 'Alice', storage }).state;
  state = issueCustomerToken({ state, serviceId: 'finance', customerName: 'Bob', storage }).state;

  // Call Next on Admissions
  const callRes = callNextToken({ state, serviceId: 'admissions', storage });
  state = callRes.state;

  // Verify Finance is completely unaffected
  const finQueue = getServiceQueue(state, 'finance');
  assert.equal(finQueue.servingToken, null);
  assert.equal(finQueue.waitingTokens.length, 1);
  assert.equal(finQueue.waitingTokens[0].tokenNumber, 'FIN-001');
  assert.equal(finQueue.waitingTokens[0].status, TOKEN_STATUS.WAITING);
});

test('15. Failed persistence does not produce false success', () => {
  const failingStorage = {
    getItem() { return null; },
    setItem() {
      throw new Error('QuotaExceededError: LocalStorage write denied');
    },
    removeItem() {}
  };

  let state = createInitialState();
  const t1 = issueCustomerToken({ state, serviceId: 'admissions', customerName: 'Alice' }).token;
  state.tokens.push(t1);

  // Calling Next with failing storage
  const callRes = callNextToken({ state, serviceId: 'admissions', storage: failingStorage });
  assert.equal(callRes.success, false);
  assert.equal(callRes.code, 'PERSISTENCE_FAILED');
  assert.ok(callRes.error.includes('Persistence failure'));

  // Original state is preserved: t1 remains WAITING
  assert.equal(callRes.state.tokens[0].status, TOKEN_STATUS.WAITING);
});

test('16. Queue-position and Stage A estimates update correctly after dispatch actions', () => {
  const storage = createMockStorage();
  let state = createInitialState();

  // Create queue: ADM-001 (1000), ADM-002 (2000), ADM-003 (3000)
  state = issueCustomerToken({ state, serviceId: 'admissions', customerName: 'A1', timestamp: 1000, storage }).state;
  state = issueCustomerToken({ state, serviceId: 'admissions', customerName: 'A2', timestamp: 2000, storage }).state;
  state = issueCustomerToken({ state, serviceId: 'admissions', customerName: 'A3', timestamp: 3000, storage }).state;

  const t1 = state.tokens[0];
  const t2 = state.tokens[1];
  const t3 = state.tokens[2];

  // Before call: No serving token.
  // t1: pos 1, 0 ahead, wait = 0 min
  assert.equal(calculateQueuePosition(t1.id, state).position, 1);
  assert.equal(calculateStageAWaitTime(t1, state).estimatedMinutes, 0);

  // t3: pos 3, 2 ahead, wait = 2 * 5 = 10 min
  assert.equal(calculateQueuePosition(t3.id, state).position, 3);
  assert.equal(calculateStageAWaitTime(t3, state).estimatedMinutes, 10);

  // Admin calls t1 at 4000
  state = callNextToken({ state, serviceId: 'admissions', storage, timestamp: 4000 }).state;

  // Now t1 is SERVING; t2 is #1 in line; t3 is #2 in line
  assert.equal(calculateQueuePosition(t1.id, state).isServing, true);

  const t2Pos = calculateQueuePosition(t2.id, state);
  assert.equal(t2Pos.position, 1);
  assert.equal(t2Pos.waitingAhead, 0);

  const t3Pos = calculateQueuePosition(t3.id, state);
  assert.equal(t3Pos.position, 2);
  assert.equal(t3Pos.waitingAhead, 1);

  // At timestamp 4000, t1 elapsed = 0m, remaining = 5m.
  // t3 wait: Remaining(5) + 1 ahead * 5 = 10m
  assert.equal(calculateStageAWaitTime(t3, state, 4000).estimatedMinutes, 10);

  // Staff completes t1 at 6000 and calls t2 at 6000
  state = completeServingToken({ state, serviceId: 'admissions', storage, timestamp: 6000 }).state;
  state = callNextToken({ state, serviceId: 'admissions', storage, timestamp: 6000 }).state;

  // Now t3 is head of waiting line: #1 in line, 0 ahead
  const t3PosNew = calculateQueuePosition(t3.id, state);
  assert.equal(t3PosNew.position, 1);
  assert.equal(t3PosNew.waitingAhead, 0);

  // t3 wait: Remaining(5) + 0 * 5 = 5m
  assert.equal(calculateStageAWaitTime(t3, state, 6000).estimatedMinutes, 5);
});
