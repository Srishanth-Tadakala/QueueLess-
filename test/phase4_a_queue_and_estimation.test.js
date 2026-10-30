import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialState,
  createToken,
  applyTransition,
  TOKEN_STATUS
} from '../src/utils/queueModel.js';

import {
  getServiceQueue,
  calculateQueuePosition,
  calculateStageAWaitTime,
  getQueueMetrics
} from '../src/utils/estimationEngine.js';

test('1. First waiting token has position 1 and 0 waiting ahead', () => {
  let state = createInitialState();
  const t1 = createToken(state, 'admissions', 'Alice').token;
  state.tokens.push(t1);

  const pos = calculateQueuePosition(t1.id, state);
  assert.equal(pos.position, 1);
  assert.equal(pos.waitingAhead, 0);
  assert.equal(pos.isNextInLine, true);
  assert.equal(pos.displayText, 'Position: #1 (Next in line)');
});

test('2. Second waiting token has position 2 and 1 waiting ahead', () => {
  let state = createInitialState();
  const t1 = createToken(state, 'admissions', 'Alice', 1000).token;
  const t2 = createToken(state, 'admissions', 'Bob', 2000).token;
  state.tokens.push(t1, t2);

  const pos2 = calculateQueuePosition(t2.id, state);
  assert.equal(pos2.position, 2);
  assert.equal(pos2.waitingAhead, 1);
  assert.equal(pos2.isNextInLine, false);
  assert.equal(pos2.displayText, 'Position: #2 in line');
});

test('3. Terminal tokens (COMPLETED, CANCELLED) do not affect waiting positions', () => {
  let state = createInitialState();
  const t1 = createToken(state, 'finance', 'Alice', 1000).token;
  const t2 = createToken(state, 'finance', 'Bob', 2000).token;
  const t3 = createToken(state, 'finance', 'Charlie', 3000).token;
  state.tokens.push(t1, t2, t3);

  // t1 is COMPLETED, t2 is CANCELLED
  t1.status = TOKEN_STATUS.COMPLETED;
  t2.status = TOKEN_STATUS.CANCELLED;

  // t3 is the only WAITING token left
  const pos3 = calculateQueuePosition(t3.id, state);
  assert.equal(pos3.position, 1);
  assert.equal(pos3.waitingAhead, 0);
  assert.equal(pos3.isNextInLine, true);
});

test('4. Skipped tokens do not count as waiting', () => {
  let state = createInitialState();
  const t1 = createToken(state, 'admissions', 'Alice', 1000).token;
  const t2 = createToken(state, 'admissions', 'Bob', 2000).token;
  state.tokens.push(t1, t2);

  // t1 is SKIPPED
  t1.status = TOKEN_STATUS.SKIPPED;

  // t1 itself has null position
  const pos1 = calculateQueuePosition(t1.id, state);
  assert.equal(pos1.position, null);
  assert.equal(pos1.status, TOKEN_STATUS.SKIPPED);

  // t2 becomes position #1
  const pos2 = calculateQueuePosition(t2.id, state);
  assert.equal(pos2.position, 1);
  assert.equal(pos2.waitingAhead, 0);
});

test('5. Re-queued tokens follow the correct FIFO order (appended to tail)', () => {
  let state = createInitialState();
  const t1 = createToken(state, 'admissions', 'Alice', 1000).token;
  const t2 = createToken(state, 'admissions', 'Bob', 2000).token;
  state.tokens.push(t1, t2);

  // t1 was serving, then skipped at t=3000
  t1.status = TOKEN_STATUS.SERVING;
  state = applyTransition(state, t1.id, TOKEN_STATUS.SKIPPED, 3000).state;

  // Re-queue t1 at t=4000
  state = applyTransition(state, t1.id, TOKEN_STATUS.WAITING, 4000).state;

  // Now, t2 has createdAt=2000 and t1 has createdAt=4000
  // t2 must be position #1, t1 must be position #2
  const posT2 = calculateQueuePosition(t2.id, state);
  const posT1 = calculateQueuePosition(t1.id, state);

  assert.equal(posT2.position, 1);
  assert.equal(posT1.position, 2);
  assert.equal(posT1.waitingAhead, 1);
});

test('6. Empty-queue behavior is correct', () => {
  const state = createInitialState();
  const queue = getServiceQueue(state, 'admissions');
  assert.equal(queue.servingToken, null);
  assert.equal(queue.waitingTokens.length, 0);
  assert.equal(queue.totalWaiting, 0);
});

test('7. Stage A estimates use the correct service baseline (ADM: 5m, FIN: 3m, EXM: 6m)', () => {
  let state = createInitialState();
  const tAdm = createToken(state, 'admissions', 'A', 1000).token;
  const tFin = createToken(state, 'finance', 'B', 1000).token;
  const tExm = createToken(state, 'examinations', 'C', 1000).token;
  state.tokens.push(tAdm, tFin, tExm);

  // When no token is serving and 0 ahead: estimated wait is 0 min (Ready now)
  const waitAdm0 = calculateStageAWaitTime(tAdm.id, state);
  assert.equal(waitAdm0.estimatedMinutes, 0);
  assert.equal(waitAdm0.displayText, '0 min (Ready now)');
  assert.equal(waitAdm0.baselineDuration, 5);

  // Now add a second token for each service (N_ahead = 1)
  const tAdm2 = createToken(state, 'admissions', 'A2', 2000).token;
  const tFin2 = createToken(state, 'finance', 'B2', 2000).token;
  const tExm2 = createToken(state, 'examinations', 'C2', 2000).token;
  state.tokens.push(tAdm2, tFin2, tExm2);

  // Estimated wait = 1 * baseline
  const waitAdm = calculateStageAWaitTime(tAdm2.id, state);
  assert.equal(waitAdm.estimatedMinutes, 5); // 1 * 5
  assert.equal(waitAdm.baselineDuration, 5);

  const waitFin = calculateStageAWaitTime(tFin2.id, state);
  assert.equal(waitFin.estimatedMinutes, 3); // 1 * 3
  assert.equal(waitFin.baselineDuration, 3);

  const waitExm = calculateStageAWaitTime(tExm2.id, state);
  assert.equal(waitExm.estimatedMinutes, 6); // 1 * 6
  assert.equal(waitExm.baselineDuration, 6);
});

test('8. Current serving token is accounted for according to approved formula', () => {
  let state = createInitialState();
  const t1 = createToken(state, 'admissions', 'Alice', 1000).token;
  const t2 = createToken(state, 'admissions', 'Bob', 2000).token;
  const t3 = createToken(state, 'admissions', 'Charlie', 3000).token;
  state.tokens.push(t1, t2, t3);

  // t1 is called at t = 10:01:00 (61000 ms)
  t1.status = TOKEN_STATUS.SERVING;
  t1.calledAt = 60000; // called at 1 minute mark

  // Evaluate at t = 10:03:00 (180000 ms, elapsed = 2 min)
  const currentTime = 180000;
  // Baseline = 5 min. Elapsed = (180000 - 60000) / 60000 = 2 min.
  // RemainingCurrentService = 5 - 2 = 3 min.

  // For t2: N_ahead = 0. Wait = 3 + (0 * 5) = 3 min
  const waitT2 = calculateStageAWaitTime(t2.id, state, currentTime);
  assert.equal(waitT2.remainingCurrentService, 3);
  assert.equal(waitT2.estimatedMinutes, 3);
  assert.equal(waitT2.displayText, '~3 min (Until call)');

  // For t3: N_ahead = 1. Wait = 3 + (1 * 5) = 8 min
  const waitT3 = calculateStageAWaitTime(t3.id, state, currentTime);
  assert.equal(waitT3.remainingCurrentService, 3);
  assert.equal(waitT3.estimatedMinutes, 8);
  assert.equal(waitT3.displayText, '~8 min estimated');
});

test('9. Serving customer is not shown as waiting', () => {
  let state = createInitialState();
  const t1 = createToken(state, 'admissions', 'Alice', 1000).token;
  t1.status = TOKEN_STATUS.SERVING;
  t1.calledAt = 1000;
  state.tokens.push(t1);

  const pos = calculateQueuePosition(t1.id, state);
  assert.equal(pos.isServing, true);
  assert.equal(pos.position, 'Now Serving');
  assert.equal(pos.displayText, 'Now Serving — Please proceed to counter');

  const wait = calculateStageAWaitTime(t1.id, state);
  assert.equal(wait.isServing, true);
  assert.equal(wait.displayText, 'At Counter');
});

test('10. Completed and cancelled customers do not receive misleading active estimates', () => {
  let state = createInitialState();
  const tComp = createToken(state, 'admissions', 'Alice', 1000).token;
  tComp.status = TOKEN_STATUS.COMPLETED;
  const tCanc = createToken(state, 'admissions', 'Bob', 2000).token;
  tCanc.status = TOKEN_STATUS.CANCELLED;
  state.tokens.push(tComp, tCanc);

  const waitComp = calculateStageAWaitTime(tComp.id, state);
  assert.equal(waitComp.estimatedMinutes, null);
  assert.equal(waitComp.displayText, 'N/A');

  const waitCanc = calculateStageAWaitTime(tCanc.id, state);
  assert.equal(waitCanc.estimatedMinutes, null);
  assert.equal(waitCanc.displayText, 'N/A');
});

test('11. Missing or invalid token identifiers are handled safely', () => {
  const state = createInitialState();
  const pos = calculateQueuePosition('NON_EXISTENT_ID', state);
  assert.equal(pos.status, 'NOT_FOUND');
  assert.equal(pos.position, null);
  assert.equal(pos.displayText, 'Token not found');

  const wait = calculateStageAWaitTime('NON_EXISTENT_ID', state);
  assert.equal(wait.estimatedMinutes, null);
  assert.equal(wait.displayText, 'N/A');

  // getQueueMetrics also handles missing tokens cleanly
  const metrics = getQueueMetrics('NON_EXISTENT_ID', state);
  assert.equal(metrics.status, 'NOT_FOUND');
  assert.equal(metrics.position, null);
});

test('12. Deterministic tie-breaker for identical timestamps', () => {
  let state = createInitialState();
  // Two tokens created with identical timestamp
  const tA = { ...createToken(state, 'admissions', 'User A', 5000).token, id: 'tok_5000_a', tokenNumber: 'ADM-001' };
  const tB = { ...createToken(state, 'admissions', 'User B', 5000).token, id: 'tok_5000_b', tokenNumber: 'ADM-002' };
  state.tokens.push(tB, tA); // Push out of order

  const { waitingTokens } = getServiceQueue(state, 'admissions');
  // Must deterministically sort by ID string ascending: tok_5000_a before tok_5000_b
  assert.equal(waitingTokens[0].id, 'tok_5000_a');
  assert.equal(waitingTokens[1].id, 'tok_5000_b');
});
