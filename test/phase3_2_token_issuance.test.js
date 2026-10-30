import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialState,
  TOKEN_STATUS,
  SERVICE_STATUS,
  setServiceStatus,
  applyTransition
} from '../src/utils/queueModel.js';

import {
  APPROVED_SERVICES
} from '../src/utils/services.js';

import {
  QUEUELESS_STORAGE_KEY,
  loadQueueState,
  saveQueueState
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

test('1. Loads initial queue state when storage is empty', () => {
  const mockStorage = createMockStorage();
  const loadRes = loadQueueState(mockStorage);
  assert.equal(loadRes.source, 'empty');
  assert.equal(loadRes.state.version, 1);
  assert.deepEqual(loadRes.state.tokens, []);
  assert.equal(loadRes.state.sequenceCounters.admissions, 0);
  assert.equal(loadRes.state.sequenceCounters.finance, 0);
  assert.equal(loadRes.state.sequenceCounters.examinations, 0);
});

test('2. A valid service selection issues the correct first token (ADM-001, FIN-001, EXM-001)', () => {
  const storage1 = createMockStorage();
  const state1 = createInitialState();
  const r1 = issueCustomerToken({ state: state1, serviceId: 'admissions', storage: storage1 });
  assert.equal(r1.success, true);
  assert.equal(r1.token.tokenNumber, 'ADM-001');
  assert.equal(r1.token.serviceId, 'admissions');
  assert.equal(r1.token.status, TOKEN_STATUS.WAITING);

  const storage2 = createMockStorage();
  const state2 = createInitialState();
  const r2 = issueCustomerToken({ state: state2, serviceId: 'finance', storage: storage2 });
  assert.equal(r2.success, true);
  assert.equal(r2.token.tokenNumber, 'FIN-001');

  const storage3 = createMockStorage();
  const state3 = createInitialState();
  const r3 = issueCustomerToken({ state: state3, serviceId: 'examinations', storage: storage3 });
  assert.equal(r3.success, true);
  assert.equal(r3.token.tokenNumber, 'EXM-001');
});

test('3. The correct service counter increments upon token issuance', () => {
  const mockStorage = createMockStorage();
  let state = createInitialState();

  const r1 = issueCustomerToken({ state, serviceId: 'admissions', customerName: 'Alice', storage: mockStorage });
  assert.equal(r1.success, true);
  state = r1.state;
  assert.equal(state.sequenceCounters.admissions, 1);

  // In another session, issue second Admissions token
  const r2 = issueCustomerToken({ state, serviceId: 'admissions', customerName: 'Bob', storage: mockStorage, sessionTokenId: null });
  assert.equal(r2.success, true);
  state = r2.state;
  assert.equal(state.sequenceCounters.admissions, 2);
  assert.equal(r2.token.tokenNumber, 'ADM-002');
});

test('4. Other service counters remain unchanged when a service issues a token', () => {
  const mockStorage = createMockStorage();
  let state = createInitialState();

  const r1 = issueCustomerToken({ state, serviceId: 'finance', storage: mockStorage });
  state = r1.state;

  assert.equal(state.sequenceCounters.finance, 1);
  assert.equal(state.sequenceCounters.admissions, 0);
  assert.equal(state.sequenceCounters.examinations, 0);
});

test('5. A paused service cannot issue a token', () => {
  const mockStorage = createMockStorage();
  let state = createInitialState();

  // Pause Finance
  state = setServiceStatus(state, 'finance', SERVICE_STATUS.PAUSED);

  const result = issueCustomerToken({ state, serviceId: 'finance', storage: mockStorage });
  assert.equal(result.success, false);
  assert.equal(result.code, 'SERVICE_PAUSED');
  assert.ok(result.error.includes('currently PAUSED'));

  // Finance counter must remain 0
  assert.equal(state.sequenceCounters.finance, 0);
});

test('6. A second active token is rejected for the same browser session', () => {
  const mockStorage = createMockStorage();
  let state = createInitialState();

  // First token issued in this session
  const r1 = issueCustomerToken({ state, serviceId: 'admissions', storage: mockStorage });
  assert.equal(r1.success, true);
  state = r1.state;
  const sessionTokenId = r1.token.id;

  // Session ID recorded in storage
  assert.equal(mockStorage.getItem(SESSION_TOKEN_KEY), sessionTokenId);

  // Attempt to issue another token while holding ADM-001 in WAITING
  const r2 = issueCustomerToken({
    state,
    serviceId: 'finance',
    sessionTokenId,
    storage: mockStorage
  });

  assert.equal(r2.success, false);
  assert.equal(r2.code, 'ACTIVE_TOKEN_EXISTS');
  assert.ok(r2.error.includes('You already hold an active token (ADM-001)'));
  assert.equal(r2.activeToken.id, sessionTokenId);

  // Counters must not have incremented for Finance
  assert.equal(state.sequenceCounters.finance, 0);
});

test('7. Completed, skipped, or cancelled tokens are handled according to active-token rule', () => {
  const mockStorage = createMockStorage();
  let state = createInitialState();

  // Issue first token
  const r1 = issueCustomerToken({ state, serviceId: 'admissions', storage: mockStorage });
  state = r1.state;
  const sessionTokenId = r1.token.id;

  // Case A: Token is CANCELLED -> User can now issue a new token
  const cancelRes = cancelCustomerToken({ state, tokenId: sessionTokenId, storage: mockStorage });
  assert.equal(cancelRes.success, true);
  state = cancelRes.state;

  // User session token reference cleared
  const activeAfterCancel = getActiveSessionToken(state, sessionTokenId);
  assert.equal(activeAfterCancel, null);

  // New token issuance must succeed now!
  const r2 = issueCustomerToken({
    state,
    serviceId: 'finance',
    sessionTokenId: null,
    storage: mockStorage
  });
  assert.equal(r2.success, true);
  assert.equal(r2.token.tokenNumber, 'FIN-001');
  state = r2.state;
  const sessionTokenId2 = r2.token.id;

  // Case B: Token is COMPLETED -> User can issue new token
  state = applyTransition(state, sessionTokenId2, TOKEN_STATUS.SERVING).state;
  state = applyTransition(state, sessionTokenId2, TOKEN_STATUS.COMPLETED).state;

  const activeAfterComp = getActiveSessionToken(state, sessionTokenId2);
  assert.equal(activeAfterComp, null);

  const r3 = issueCustomerToken({
    state,
    serviceId: 'examinations',
    sessionTokenId: null,
    storage: mockStorage
  });
  assert.equal(r3.success, true);
  assert.equal(r3.token.tokenNumber, 'EXM-001');
});

test('8. Failed persistence does not produce a false success result', () => {
  const failingStorage = {
    getItem() { return null; },
    setItem() {
      const err = new Error('Storage write failed (QuotaExceededError)');
      err.name = 'QuotaExceededError';
      throw err;
    },
    removeItem() {}
  };

  const state = createInitialState();
  const result = issueCustomerToken({
    state,
    serviceId: 'admissions',
    storage: failingStorage
  });

  // Must not claim success
  assert.equal(result.success, false);
  assert.equal(result.code, 'PERSISTENCE_FAILED');
  assert.ok(result.error.includes('Persistence failure'));

  // Returned state must be original state (not modified)
  assert.equal(result.state.tokens.length, 0);
  assert.equal(result.state.sequenceCounters.admissions, 0);
});

test('9. Invalid service identifiers are rejected', () => {
  const mockStorage = createMockStorage();
  const state = createInitialState();

  const result = issueCustomerToken({
    state,
    serviceId: 'cafeteria', // Not in approved catalog
    storage: mockStorage
  });

  assert.equal(result.success, false);
  assert.equal(result.code, 'INVALID_SERVICE');
  assert.ok(result.error.includes('Invalid service identifier'));
  assert.deepEqual(result.state.tokens, []);
});

test('10. Token numbering invariant: no 000 token is ever generated', () => {
  const mockStorage = createMockStorage();
  let state = createInitialState();

  // Reset state sequence
  state.sequenceCounters.admissions = 0;

  const r1 = issueCustomerToken({ state, serviceId: 'admissions', storage: mockStorage });
  assert.equal(r1.token.tokenNumber, 'ADM-001');
  assert.notEqual(r1.token.tokenNumber, 'ADM-000');
});
