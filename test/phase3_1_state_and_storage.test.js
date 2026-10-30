import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TOKEN_STATUS,
  SERVICE_STATUS,
  createInitialState,
  validateQueueState,
  createToken,
  canTransition,
  applyTransition,
  setServiceStatus,
  resetQueueState
} from '../src/utils/queueModel.js';

import {
  formatTokenNumber,
  APPROVED_SERVICES
} from '../src/utils/services.js';

import {
  QUEUELESS_STORAGE_KEY,
  loadQueueState,
  saveQueueState,
  resetQueueStorage
} from '../src/utils/storage.js';

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

test('1. Empty state initialization matches approved schema', () => {
  const state = createInitialState();
  assert.equal(state.version, 1);
  assert.ok(typeof state.lastUpdatedAt === 'number');
  assert.deepEqual(state.tokens, []);

  // Check sequence counters initialized to 0 for all approved services
  assert.equal(state.sequenceCounters.admissions, 0);
  assert.equal(state.sequenceCounters.finance, 0);
  assert.equal(state.sequenceCounters.examinations, 0);

  // Check service statuses initialized to ACTIVE
  assert.equal(state.serviceStatuses.admissions, SERVICE_STATUS.ACTIVE);
  assert.equal(state.serviceStatuses.finance, SERVICE_STATUS.ACTIVE);
  assert.equal(state.serviceStatuses.examinations, SERVICE_STATUS.ACTIVE);

  const validation = validateQueueState(state);
  assert.equal(validation.isValid, true);
  assert.equal(validation.errors.length, 0);
});

test('2. Independent service sequence counters and formatting', () => {
  let state = createInitialState();

  // Create token for Admissions
  const r1 = createToken(state, 'admissions', 'Alice');
  state = r1.state;
  assert.equal(r1.token.tokenNumber, 'ADM-001');
  assert.equal(state.sequenceCounters.admissions, 1);
  assert.equal(state.sequenceCounters.finance, 0);
  assert.equal(state.sequenceCounters.examinations, 0);

  // Create second token for Admissions
  const r2 = createToken(state, 'admissions', 'Bob');
  state = r2.state;
  assert.equal(r2.token.tokenNumber, 'ADM-002');
  assert.equal(state.sequenceCounters.admissions, 2);

  // Create token for Finance (must start at 001 independently)
  const r3 = createToken(state, 'finance', 'Charlie');
  state = r3.state;
  assert.equal(r3.token.tokenNumber, 'FIN-001');
  assert.equal(state.sequenceCounters.finance, 1);
  assert.equal(state.sequenceCounters.admissions, 2);

  // Create token for Examinations (must start at 001 independently)
  const r4 = createToken(state, 'examinations', 'Diana');
  state = r4.state;
  assert.equal(r4.token.tokenNumber, 'EXM-001');
  assert.equal(state.sequenceCounters.examinations, 1);
});

test('3. Token numbering invariant for 1, 9, 10, 99, 100, and no 000 display', () => {
  // Test formatting for standard milestones
  assert.equal(formatTokenNumber('ADM', 1), 'ADM-001');
  assert.equal(formatTokenNumber('ADM', 9), 'ADM-009');
  assert.equal(formatTokenNumber('ADM', 10), 'ADM-010');
  assert.equal(formatTokenNumber('ADM', 99), 'ADM-099');
  assert.equal(formatTokenNumber('ADM', 100), 'ADM-100');

  // Verify non-positive inputs are clamped to 1, preventing '000'
  assert.equal(formatTokenNumber('ADM', 0), 'ADM-001');
  assert.equal(formatTokenNumber('ADM', -1), 'ADM-001');
  assert.notEqual(formatTokenNumber('ADM', 0), 'ADM-000');
});

test('4. Persistence across reload-equivalent reads', () => {
  const mockStorage = createMockStorage();

  // Create and save state
  let state = createInitialState();
  const res1 = createToken(state, 'admissions', 'User 1');
  const res2 = createToken(res1.state, 'finance', 'User 2');
  state = res2.state;

  const saveRes = saveQueueState(state, mockStorage);
  assert.equal(saveRes.success, true);

  // Reload state from storage
  const loadRes = loadQueueState(mockStorage);
  assert.equal(loadRes.source, 'storage');
  assert.equal(loadRes.state.tokens.length, 2);
  assert.equal(loadRes.state.tokens[0].tokenNumber, 'ADM-001');
  assert.equal(loadRes.state.tokens[1].tokenNumber, 'FIN-001');
  assert.equal(loadRes.state.sequenceCounters.admissions, 1);
  assert.equal(loadRes.state.sequenceCounters.finance, 1);
});

test('5. Recovery behavior for malformed saved JSON', () => {
  const mockStorage = createMockStorage({
    [QUEUELESS_STORAGE_KEY]: 'MALFORMED_JSON_CORRUPT{[{'
  });

  const loadRes = loadQueueState(mockStorage);
  assert.equal(loadRes.source, 'fallback_malformed');
  assert.ok(loadRes.error.includes('Malformed JSON'));

  // Must cleanly return a valid initial state without throwing
  assert.equal(loadRes.state.version, 1);
  assert.deepEqual(loadRes.state.tokens, []);
  assert.equal(validateQueueState(loadRes.state).isValid, true);
});

test('6. Storage access failure handling (simulating QuotaExceededError or security block)', () => {
  const failingStorage = {
    getItem() {
      throw new Error('Access denied by browser security policy (Private Mode)');
    },
    setItem() {
      const err = new Error('The quota has been exceeded');
      err.name = 'QuotaExceededError';
      throw err;
    },
    removeItem() {}
  };

  // Read attempt must not crash React
  const loadRes = loadQueueState(failingStorage);
  assert.equal(loadRes.source, 'fallback_storage_error');
  assert.ok(loadRes.error.includes('Access denied'));
  assert.equal(validateQueueState(loadRes.state).isValid, true);

  // Write attempt must not crash React
  const state = createInitialState();
  const saveRes = saveQueueState(state, failingStorage);
  assert.equal(saveRes.success, false);
  assert.ok(saveRes.error.includes('quota has been exceeded'));
});

test('7. Valid lifecycle transitions specified by requirements', () => {
  let state = createInitialState();
  const t1 = createToken(state, 'admissions', 'Alice');
  state = t1.state;
  const tokenId = t1.token.id;

  // 1. WAITING -> SERVING
  const now1 = 1730000001000;
  const callRes = applyTransition(state, tokenId, TOKEN_STATUS.SERVING, now1);
  assert.equal(callRes.success, true);
  assert.equal(callRes.token.status, TOKEN_STATUS.SERVING);
  assert.equal(callRes.token.calledAt, now1);
  state = callRes.state;

  // 2. SERVING -> COMPLETED
  const now2 = 1730000005000;
  const compRes = applyTransition(state, tokenId, TOKEN_STATUS.COMPLETED, now2);
  assert.equal(compRes.success, true);
  assert.equal(compRes.token.status, TOKEN_STATUS.COMPLETED);
  assert.equal(compRes.token.completedAt, now2);
  assert.equal(compRes.token.skippedAt, null);
  state = compRes.state;

  // 3. Test Skip and Re-queue on second token
  const t2 = createToken(state, 'admissions', 'Bob');
  state = t2.state;
  const tokenId2 = t2.token.id;

  // Call second token
  const callRes2 = applyTransition(state, tokenId2, TOKEN_STATUS.SERVING, 1730000010000);
  state = callRes2.state;

  // Skip second token
  const skipRes = applyTransition(state, tokenId2, TOKEN_STATUS.SKIPPED, 1730000015000);
  assert.equal(skipRes.success, true);
  assert.equal(skipRes.token.status, TOKEN_STATUS.SKIPPED);
  assert.equal(skipRes.token.skippedAt, 1730000015000);
  assert.equal(skipRes.token.completedAt, null);
  state = skipRes.state;

  // Re-queue skipped token back to WAITING (tail append rule)
  const requeueTime = 1730000020000;
  const requeueRes = applyTransition(state, tokenId2, TOKEN_STATUS.WAITING, requeueTime);
  assert.equal(requeueRes.success, true);
  assert.equal(requeueRes.token.status, TOKEN_STATUS.WAITING);
  assert.equal(requeueRes.token.calledAt, null);
  assert.equal(requeueRes.token.completedAt, null);
  assert.equal(requeueRes.token.skippedAt, null);
  assert.equal(requeueRes.token.createdAt, requeueTime);
  assert.equal(requeueRes.token.requeueCount, 1);
});

test('8. Rejection of invalid lifecycle transitions', () => {
  let state = createInitialState();
  const t1 = createToken(state, 'admissions', 'Alice');
  const t2 = createToken(t1.state, 'admissions', 'Bob');
  state = t2.state;

  const id1 = t1.token.id;
  const id2 = t2.token.id;

  // Invalid: WAITING directly to COMPLETED (cannot bypass SERVING)
  const inv1 = applyTransition(state, id1, TOKEN_STATUS.COMPLETED);
  assert.equal(inv1.success, false);
  assert.ok(inv1.reason.includes('Tokens cannot bypass the SERVING state'));

  // Put t1 into SERVING
  state = applyTransition(state, id1, TOKEN_STATUS.SERVING).state;

  // Invalid: Calling t2 while t1 is already SERVING at the counter
  const inv2 = applyTransition(state, id2, TOKEN_STATUS.SERVING);
  assert.equal(inv2.success, false);
  assert.ok(inv2.reason.includes('currently SERVING at this counter'));

  // Mark t1 COMPLETED
  state = applyTransition(state, id1, TOKEN_STATUS.COMPLETED).state;

  // Invalid: Modifying terminal COMPLETED state
  const inv3 = applyTransition(state, id1, TOKEN_STATUS.WAITING);
  assert.equal(inv3.success, false);
  assert.ok(inv3.reason.includes('terminal state'));
});

test('9. Immutability of original state after rejected transition', () => {
  let state = createInitialState();
  const t1 = createToken(state, 'admissions', 'Alice');
  state = t1.state;

  const originalStateFrozen = JSON.parse(JSON.stringify(state));

  // Attempt invalid transition
  const rejected = applyTransition(state, t1.token.id, TOKEN_STATUS.COMPLETED);
  assert.equal(rejected.success, false);

  // Original state must be completely untouched
  assert.deepEqual(state, originalStateFrozen);
  assert.equal(state.tokens[0].status, TOKEN_STATUS.WAITING);
});

test('10. Reset semantics and counter restart at 001', () => {
  const mockStorage = createMockStorage();

  // Create state with several tokens
  let state = createInitialState();
  state = createToken(state, 'admissions', 'Alice').state;
  state = createToken(state, 'admissions', 'Bob').state;
  state = createToken(state, 'finance', 'Charlie').state;
  saveQueueState(state, mockStorage);

  assert.equal(state.sequenceCounters.admissions, 2);
  assert.equal(state.sequenceCounters.finance, 1);

  // Trigger reset
  const resetRes = resetQueueStorage(mockStorage);
  assert.equal(resetRes.success, true);
  assert.equal(resetRes.state.tokens.length, 0);
  assert.equal(resetRes.state.sequenceCounters.admissions, 0);
  assert.equal(resetRes.state.sequenceCounters.finance, 0);

  // Next token created after reset MUST be 001
  const afterReset = createToken(resetRes.state, 'admissions', 'David');
  assert.equal(afterReset.token.tokenNumber, 'ADM-001');
  assert.equal(afterReset.state.sequenceCounters.admissions, 1);
});

test('11. Service Pausing restriction', () => {
  let state = createInitialState();

  // Pause admissions
  state = setServiceStatus(state, 'admissions', SERVICE_STATUS.PAUSED);
  assert.equal(state.serviceStatuses.admissions, SERVICE_STATUS.PAUSED);

  // Attempting to create token for paused service must throw
  assert.throws(
    () => createToken(state, 'admissions', 'Eve'),
    /currently PAUSED/
  );

  // Unpaused services still work
  const finToken = createToken(state, 'finance', 'Frank');
  assert.equal(finToken.token.tokenNumber, 'FIN-001');
});
