# Test Cases & Verification Suite
## Project: QueueLess — Smart Queue Management & Waiting-Time Estimation Web Application
**Academic Context:** Semester 3 CSE (AI/ML) End Semester Examination (ESE)  
**Specification Reference:** [docs/requirements.md](requirements.md)  
**Document Status:** Verification Baseline Locked  
**Execution Status:** 33 Tests Total — **33 Planned (Unexecuted)**, **0 Passed**, **0 Failed**  
*(Note: As per academic integrity guidelines, test execution evidence will be recorded during Phase 2 implementation; no simulated execution is claimed).*

---

## 1. Test Suite Summary & Traceability Matrix

| Suite ID | Focus Area | Planned Tests | Executed Tests | Status | Target Scope |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **TS-01** | Service Catalog & Token Generation | 4 | 0 | Planned | Must-Have MVP |
| **TS-02** | Queue Position & Mathematical Wait Estimation | 5 | 0 | Planned | Must-Have MVP (Numerical Validation) |
| **TS-03** | Finite State Machine (FSM) Transitions & Guards | 8 | 0 | Planned | Must-Have MVP |
| **TS-04** | Administrator Counter Controls & Edge Dispatches | 5 | 0 | Planned | Must-Have MVP |
| **TS-05** | Calculation Models & Skipped-Token Exclusion | 4 | 0 | Planned | Stage A (MVP) & Stage B (Enhancement) |
| **TS-06** | State Persistence, Storage Errors & Recovery | 4 | 0 | Planned | Must-Have MVP & Robustness |
| **TS-07** | Cross-Tab Synchronization & Concurrency Handling | 3 | 0 | Planned | Recommended Enhancement |
| **TOTAL** | **Comprehensive Test Coverage** | **33** | **0** | **Planned Baseline** | |

---

## 2. Detailed Test Specifications

### Suite 01: Service Catalog & Token Generation

#### TC-01.1: Service Catalog Display
- **Status:** Planned (Unexecuted)
- **Objective:** Verify that all 3 configured services load with correct baseline attributes.
- **Preconditions:** Clean or active queue in `localStorage`.
- **Steps:**
  1. Open browser and navigate to `/`.
  2. Inspect the service selection section.
- **Expected Result:** Admissions (`ADM`, 5 min), Finance (`FIN`, 3 min), and Examinations (`EXM`, 6 min) are rendered showing service name, code, and live waiting token count.

#### TC-01.2: Token Creation & Sequential Formatting
- **Status:** Planned (Unexecuted)
- **Objective:** Verify that selecting a service generates a correctly formatted sequential token.
- **Preconditions:** 0 existing tokens for service `ADM`.
- **Steps:**
  1. Click on "Admissions & Verification".
  2. Click "Get Token".
- **Expected Result:**
  - Token `ADM-001` is generated with `createdAt = Date.now()`, `status = 'WAITING'`, and `requeueCount = 0`.
  - Token is stored in `localStorage` as user's active token.
  - Browser automatically redirects to `/tracker`.

#### TC-01.3: Single-Token Session Constraint
- **Status:** Planned (Unexecuted)
- **Objective:** Ensure one customer session cannot hold multiple concurrent active tokens.
- **Preconditions:** User holds active token `ADM-001` in `WAITING` status.
- **Steps:**
  1. User manually navigates back to `/` or clicks the application logo.
  2. User attempts to click "Get Token" on Finance service.
- **Expected Result:** Application detects active session token and redirects user directly to `/tracker`, preventing second token creation.

#### TC-01.4: Paused Service Restriction
- **Status:** Planned (Unexecuted)
- **Objective:** Ensure visitors cannot generate tokens for a paused counter.
- **Preconditions:** Admin has toggled service `FIN` to `PAUSED`.
- **Steps:**
  1. Visitor views the Home page (`/`).
  2. Visitor inspects the Finance card.
- **Expected Result:** "Get Token" button is disabled; displays banner: *"Counter temporarily paused."*

---

### Suite 02: Queue Position & Mathematical Wait Estimation (Numerical Examples)

*Reference service: Admissions ($T_{\text{baseline}} = 5 \text{ minutes}$).*

#### TC-02.1: Numerical Test 1 — Empty Queue Arrival (Zero Wait Meaning)
- **Status:** Planned (Unexecuted)
- **Objective:** Verify that an estimated wait of 0 indicates counter readiness to call immediately, not instant transaction completion.
- **Preconditions:** No token serving, 0 tokens waiting.
- **Steps:**
  1. Customer generates token `ADM-001`.
  2. Customer views `/tracker`.
- **Expected Result:**
  - Serving token: None $\implies$ Branch 2 evaluated.
  - $N_{\text{ahead}} = 0$.
  - Displayed Position $P = \mathbf{\#1 \text{ (Next in line)}}$.
  - Estimated Wait $= 0 \times 5 = \mathbf{0 \text{ minutes}}$.
  - UI Wording: *"You are next in line — Counter is ready to call you"* (Estimated: `"0 min (Ready now)"`).

#### TC-02.2: Numerical Test 2 — One Serving Token, Zero Waiting Ahead
- **Status:** Planned (Unexecuted)
- **Objective:** Verify waiting time when user is next in line while a customer is currently being served.
- **Preconditions:** `ADM-001` was called 2 minutes ago ($\text{elapsed} = 2 \text{ min}$, $\text{remaining} = 3 \text{ min}$).
- **Steps:**
  1. Customer generates token `ADM-002`.
  2. Customer views `/tracker`.
- **Expected Result:**
  - Serving token: `ADM-001` ($\text{Remaining} = 3 \text{ min}$) $\implies$ Branch 1 evaluated.
  - Waiting ahead ($N_{\text{ahead}}$): $0$.
  - Displayed Position $P = \mathbf{\#1 \text{ in waiting line}}$.
  - UI Wording: *"You are next in line — Please remain near counter"*.
  - Estimated Wait $= 3 + (0 \times 5) = \mathbf{3 \text{ minutes}}$.

#### TC-02.3: Numerical Test 3 — Multiple Waiting Tokens
- **Status:** Planned (Unexecuted)
- **Objective:** Verify calculations for a customer deep in the waiting line.
- **Preconditions:** `ADM-001` serving (called 1 min ago, $\text{remaining} = 4 \text{ min}$). Waiting in queue: `ADM-002`, `ADM-003`, `ADM-004`.
- **Steps:**
  1. Customer generates token `ADM-005`.
  2. Customer views `/tracker`.
- **Expected Result:**
  - Serving token: `ADM-001` ($\text{Remaining} = 4 \text{ min}$).
  - Waiting ahead: `ADM-002`, `ADM-003`, `ADM-004` $\implies N_{\text{ahead}} = 3$.
  - Displayed Position $P = 3 + 1 = \mathbf{\#4 \text{ in waiting line}}$.
  - UI Wording: *"Position #4 — 3 waiting tokens ahead of you"*.
  - Estimated Wait $= 4 + (3 \times 5) = \mathbf{19 \text{ minutes}}$.

#### TC-02.4: Numerical Test 4 — Token Completion & Queue Advance
- **Status:** Planned (Unexecuted)
- **Objective:** Verify dynamic position decrement and wait-time recalculation upon token completion.
- **Preconditions:** Continuing from TC-02.3.
- **Steps:**
  1. Admin marks `ADM-001` as completed (service duration: 4 minutes).
  2. Admin clicks "Call Next" $\to$ `ADM-002` called ($\text{calledAt} = \text{Now}$, $\text{remaining} = 5 \text{ min}$).
  3. Inspect `ADM-005` tracker.
- **Expected Result:**
  - Serving token: `ADM-002` ($\text{Remaining} = 5 \text{ min}$).
  - Waiting ahead: `ADM-003`, `ADM-004` $\implies N_{\text{ahead}} = 2$ (decremented by 1).
  - Displayed Position $P = 2 + 1 = \mathbf{\#3 \text{ in waiting line}}$.
  - Stage A Estimated Wait $= 5 + (2 \times 5) = \mathbf{15 \text{ minutes}}$ (decremented from 19).

#### TC-02.5: Numerical Test 5 — Skipped Token Handling
- **Status:** Planned (Unexecuted)
- **Objective:** Verify queue progression when an absentee customer is skipped.
- **Preconditions:** Continuing from TC-02.4. `ADM-002` completed. Admin calls `ADM-003`. Customer is absent.
- **Steps:**
  1. Admin clicks "Skip / No-Show" on `ADM-003`.
  2. Admin clicks "Call Next" $\to$ `ADM-004` called ($\text{remaining} = 5 \text{ min}$).
  3. Inspect `ADM-005` tracker.
- **Expected Result:**
  - Serving token: `ADM-004` ($\text{Remaining} = 5 \text{ min}$).
  - Waiting ahead: None $\implies N_{\text{ahead}} = 0$.
  - Displayed Position $P = 0 + 1 = \mathbf{\#1 \text{ in waiting line}}$.
  - Estimated Wait $= 5 + (0 \times 5) = \mathbf{5 \text{ minutes}}$.

---

### Suite 03: Finite State Machine (FSM) Transitions & Guards

#### TC-03.1: Valid Transition — WAITING to SERVING
- **Status:** Planned (Unexecuted)
- **Objective:** Verify that calling the next waiting token transitions it to `SERVING`.
- **Preconditions:** Token `ADM-001` is `WAITING`; counter is vacant.
- **Steps:** Admin clicks "Call Next".
- **Expected Result:** Status changes to `SERVING`; `calledAt` is populated with epoch timestamp.

#### TC-03.2: Valid Transition — SERVING to COMPLETED (Timestamp Exclusivity)
- **Status:** Planned (Unexecuted)
- **Objective:** Verify that completing a token records `completedAt` while keeping `skippedAt = null`.
- **Preconditions:** Token `ADM-001` is `SERVING`.
- **Steps:** Admin clicks "Mark Completed".
- **Expected Result:** Status becomes `COMPLETED`; `completedAt` is recorded; `skippedAt` remains `null`; serving slot becomes vacant.

#### TC-03.3: Valid Transition — SERVING to SKIPPED (Timestamp Exclusivity)
- **Status:** Planned (Unexecuted)
- **Objective:** Verify that skipping a token records `skippedAt` while keeping `completedAt = null`.
- **Preconditions:** Token `ADM-001` is `SERVING`.
- **Steps:** Admin clicks "Skip / No-Show".
- **Expected Result:** Status becomes `SKIPPED`; `skippedAt` is recorded; `completedAt` remains `null`; serving slot becomes vacant.

#### TC-03.4: Valid Transition — Customer Ticket Cancellation
- **Status:** Planned (Unexecuted)
- **Objective:** Verify that a user can cancel their own waiting ticket.
- **Preconditions:** User holds `FIN-002` in `WAITING` status.
- **Steps:** User clicks "Cancel Ticket" on `/tracker` and confirms modal.
- **Expected Result:** Token status transitions to `CANCELLED`; user's active session is cleared; subsequent tokens decrement $N_{\text{ahead}}$.

#### TC-03.5: Valid Transition — Skipped Token Re-queue (Fairness Tail Append)
- **Status:** Planned (Unexecuted)
- **Objective:** Verify that re-queueing a skipped token resets timestamps and appends it to the tail of the waiting line.
- **Preconditions:** Token `ADM-002` is in `SKIPPED` status. Current waiting tokens: `ADM-003`, `ADM-004`.
- **Steps:** Admin clicks "Re-queue" on `ADM-002`.
- **Expected Result:**
  - Status transitions back to `WAITING`.
  - `calledAt`, `completedAt`, and `skippedAt` are reset to `null`.
  - `createdAt` is updated to current timestamp (`Date.now()`).
  - `requeueCount` increments to 1.
  - Position becomes #3 (behind `ADM-003` and `ADM-004`), preserving fairness.

#### TC-03.6: Invalid Transition — Calling When Already Serving
- **Status:** Planned (Unexecuted)
- **Objective:** Prevent calling a new token when a customer is already at the counter.
- **Preconditions:** Token `ADM-001` is `SERVING`. Token `ADM-002` is `WAITING`.
- **Steps:** Admin attempts to dispatch "Call Next".
- **Expected Result:** Action is disabled/blocked; non-blocking alert: *"Please complete or skip the current active token first."*

#### TC-03.7: Invalid Transition — Directly Completing or Skipping a WAITING Token
- **Status:** Planned (Unexecuted)
- **Objective:** Ensure tokens cannot bypass the `SERVING` state.
- **Preconditions:** Token `FIN-001` is `WAITING`.
- **Steps:** Programmatic call to `dispatch({ type: 'COMPLETE_TOKEN', id: 'FIN-001' })`.
- **Expected Result:** State engine guard rejects the transition; logs error; state remains `WAITING`.

#### TC-03.8: Invalid Transition — Modifying Terminal State
- **Status:** Planned (Unexecuted)
- **Objective:** Ensure `COMPLETED` and `CANCELLED` tokens are immutable.
- **Preconditions:** Token `EXM-001` is in `COMPLETED` status.
- **Steps:** Programmatic call to modify its status to `SERVING` or `WAITING`.
- **Expected Result:** State engine rejects mutation; token remains in terminal state.

---

### Suite 04: Administrator Counter Controls & Edge Dispatches

#### TC-04.1: Empty Queue Action Prevention
- **Status:** Planned (Unexecuted)
- **Objective:** Prevent dispatching when waiting queue is empty.
- **Preconditions:** 0 waiting tokens for service `EXM`.
- **Steps:** Admin navigates to `/admin` and inspects "Call Next" button for `EXM`.
- **Expected Result:** Button is disabled. If clicked, no state change occurs; toast alert: *"Queue is empty."*

#### TC-04.2: Repeated / Rapid Button Clicks Debouncing
- **Status:** Planned (Unexecuted)
- **Objective:** Prevent race conditions or duplicate tokens from rapid double-clicking.
- **Preconditions:** User is on Home page; 0 active tokens.
- **Steps:** User rapidly double-clicks "Get Token" within 100ms.
- **Expected Result:** Button is disabled upon first click; exactly **one** token is created.

#### TC-04.3: Paused Service Toggle Enforcement
- **Status:** Planned (Unexecuted)
- **Objective:** Verify staff can toggle counter intake between Active and Paused.
- **Preconditions:** Service `ADM` is `ACTIVE`.
- **Steps:** Staff clicks "Pause Service" in Admin Dashboard.
- **Expected Result:**
  - Service status flips to `PAUSED`.
  - Customer view disables "Get Token" for Admissions.
  - Existing waiting tokens remain in line and can still be served.

#### TC-04.4: 1-Click Demo Data Seeding & State Integrity
- **Status:** Planned (Unexecuted)
- **Objective:** Verify 1-click viva presentation setup populates a valid, deterministic state.
- **Preconditions:** Empty queue.
- **Steps:** Admin clicks "Seed Demo Scenario" on Admin Dashboard.
- **Expected Result:**
  - 1 token in `SERVING` status.
  - 4 tokens in `WAITING` status with staggered timestamps.
  - 2 tokens in `COMPLETED` status with recorded service durations.
  - State passes schema validation without errors.

#### TC-04.5: Queue Reset All Counters Action
- **Status:** Planned (Unexecuted)
- **Objective:** Verify complete queue reset clears all tokens and resets sequence numbers.
- **Preconditions:** Active queue with tokens across multiple services.
- **Steps:** Admin clicks "Reset All Queues" and confirms prompt.
- **Expected Result:**
  - All token arrays emptied.
  - Service sequence counters reset to `000`.
  - `localStorage` updated; open customer tabs clear active sessions.

---

### Suite 05: Calculation Models & Skipped-Token Exclusion

#### TC-05.1: Stage A Baseline Duration Calculation
- **Status:** Planned (Unexecuted)
- **Objective:** Verify Stage A uses static baseline durations without requiring history.
- **Preconditions:** No completed tokens in history.
- **Steps:** Calculate wait for token at position #2 on Finance ($T_{\text{baseline}} = 3 \text{ min}$) with no serving token.
- **Expected Result:** $\text{EstimatedWait} = 1 \times 3 = \mathbf{3 \text{ minutes}}$.

#### TC-05.2: Stage B Rolling Average with Valid Completed Tokens
- **Status:** Planned (Unexecuted)
- **Objective:** Verify Stage B correctly computes the unweighted mean of up to 5 completed tokens.
- **Preconditions:** 3 completed tokens on Admissions with actual durations: 4 min, 6 min, 5 min.
- **Steps:** Calculate $\text{EstimatedServiceDuration}$ under Stage B.
- **Expected Result:** $\text{Mean} = (4 + 6 + 5) / 3 = \mathbf{5.0 \text{ minutes}}$.

#### TC-05.3: Skipped-Token Strict Exclusion from Stage B Average
- **Status:** Planned (Unexecuted)
- **Objective:** Verify that tokens with status `SKIPPED` are strictly excluded from rolling-average service duration calculations.
- **Preconditions:** Completed tokens: 4 min, 6 min. Skipped tokens: `ADM-003` (abandoned after 1 min), `ADM-004` (abandoned after 0.5 min).
- **Steps:** Compute Stage B rolling average service duration for Admissions.
- **Expected Result:**
  - Skipped tokens are filtered out by guard `status === 'COMPLETED' && completedAt !== null`.
  - Calculated duration $= (4 + 6) / 2 = \mathbf{5.0 \text{ minutes}}$ (unaffected by skipped records).

#### TC-05.4: Outlier Duration Clamping
- **Status:** Planned (Unexecuted)
- **Objective:** Ensure staff inactivity does not distort rolling-average calculations.
- **Preconditions:** Staff leaves token `ADM-001` in `SERVING` for 120 minutes before clicking Complete.
- **Steps:** Process completed token for Stage B rolling average.
- **Expected Result:** Duration calculation clamps actual elapsed time to $20.0 \text{ minutes}$ maximum.

---

### Suite 06: State Persistence, Storage Errors & Schema Validation

#### TC-06.1: Customer Session Page Reload Recovery
- **Status:** Planned (Unexecuted)
- **Objective:** Verify token tracker survives browser page refresh.
- **Preconditions:** User has active token `ADM-003` in `WAITING` status.
- **Steps:** User presses `F5` or closes and reopens tab.
- **Expected Result:** Application restores token `ADM-003`, displaying correct position and updating elapsed wait.

#### TC-06.2: Admin Counter State Reload Recovery
- **Status:** Planned (Unexecuted)
- **Objective:** Verify staff dashboard retains active serving token and elapsed time across reload.
- **Preconditions:** Staff serving `ADM-001` (called 3 minutes ago).
- **Steps:** Staff reloads `/admin`.
- **Expected Result:** Serving slot still displays `ADM-001` with elapsed time matching wall-clock difference.

#### TC-06.3: Storage Access Failure (QuotaExceededError / Private Browsing Fallback)
- **Status:** Planned (Unexecuted)
- **Objective:** Verify graceful fallback when browser blocks `localStorage` writes.
- **Preconditions:** Simulated storage write exception (`QuotaExceededError` or disabled cookies).
- **Steps:** User clicks "Get Token".
- **Expected Result:**
  - Storage adapter catches exception.
  - Warning banner informs user: *"Private browsing detected; queue state held in temporary session."*
  - Application continues operating in in-memory React state for current session without crashing.

#### TC-06.4: Malformed Storage Recovery (Corrupt JSON Schema)
- **Status:** Planned (Unexecuted)
- **Objective:** Verify graceful reset when `localStorage` contains damaged or invalid JSON.
- **Preconditions:** `localStorage.setItem('queueless_state', 'INVALID_JSON_CORRUPTED{{{')`.
- **Steps:** User reloads application.
- **Expected Result:**
  - Storage parser catches JSON error.
  - Safe default initial state is initialized.
  - User alert informs that corrupt state was reset.

---

### Suite 07: Cross-Tab Synchronization & Concurrency Handling

#### TC-07.1: Cross-Tab State Refresh on BroadcastChannel Event
- **Status:** Planned (Unexecuted)
- **Objective:** Verify that receiving a `BroadcastChannel` message triggers an in-memory state reload from `localStorage`.
- **Preconditions:** Tab 1 and Tab 2 open on same origin.
- **Steps:** Tab 1 mutates queue state and posts message `{ type: 'QUEUE_UPDATED', version: 2 }`.
- **Expected Result:** Tab 2 receives broadcast, invokes canonical reload from `localStorage`, and re-renders components within 200ms.

#### TC-07.2: Real-Time Status Change Across Tabs (Admin Call Next $\to$ Customer Tracker)
- **Status:** Planned (Unexecuted)
- **Objective:** Verify Customer Tab updates immediately when Admin calls token in another tab.
- **Preconditions:** Tab 1 has Customer Tracker for `ADM-001` open. Tab 2 has Admin Dashboard open.
- **Steps:** In Tab 2, staff clicks "Call Next" $\to$ `ADM-001` moves to `SERVING`.
- **Expected Result:** Tab 1 status badge transitions to "NOW SERVING" and displays counter instructions within 200ms without page reload.

#### TC-07.3: Real-Time Queue Position Shift Across Tabs on Cancellation
- **Status:** Planned (Unexecuted)
- **Objective:** Verify Customer Tab 1 decrements position when an earlier waiting customer cancels in Tab 2.
- **Preconditions:** Customer A (Tab 1, `ADM-003`, Position #3). Customer B (Tab 2, `ADM-002`) cancels ticket.
- **Steps:** Customer B confirms cancellation in Tab 2.
- **Expected Result:** Tab 1 updates Position to #2 immediately.
