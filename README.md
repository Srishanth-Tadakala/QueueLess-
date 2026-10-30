# QueueLess — Smart Queue Management & Waiting-Time Estimation System

> **Academic Submission:** End Semester Examination Prototype  
> **Course:** Bachelor of Technology in Computer Science & Engineering (AI/ML) — Semester 3  
> **Architecture:** Local-First Reactive Single-Page Application (SPA) with Cross-Tab Synchronization  
> **Test Suite:** 115 Automated Regression Tests (100% Passing)

---

## 1. Project Title & Overview

**QueueLess** is a modern, client-side, local-first web application designed to eliminate physical queue standing at high-traffic academic service desks. Rather than waiting in crowded physical lines, students and staff request sequential virtual tokens, monitor their real-time ordinal position in queue, and view dynamically updated waiting-time estimates powered by an adaptive statistical rolling-average estimation engine.

Operating completely within standard browser runtimes without cloud subscriptions, databases, or external network services, QueueLess leverages browser `localStorage` as its persistent source of truth and coordinates state mutations across multiple browser tabs in real time via the native `BroadcastChannel` API and resilient event fallbacks.

---

## 2. Architecture & Tech Stack

QueueLess adopts a modular, decoupled functional architecture prioritizing predictable state transitions, zero-crash fault tolerance, and minimal bundle footprint:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            PRESENTATION LAYER                               │
│       HomePage (Catalogue & Issuance)  │  TrackerPage (Live Monitoring)    │
│                     AdminPage (Counter Dispatcher & Analytics)               │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ React 18 Custom Hooks
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                             REACT HOOK LAYER                                │
│                                 useQueue.js                                 │
│          State Binding • Stale-Closure Guarding • Ambient 15s Timer         │
└───────┬──────────────────────────────┬──────────────────────────────┬───────┘
        │                              │                              │
┌───────▼──────────────┐   ┌───────────▼────────────┐   ┌─────────────▼───────┐
│ DOMAIN LOGIC         │   │ ESTIMATION & ANALYTICS │   │ SYNCHRONIZATION     │
│ queueModel.js        │   │ estimationEngine.js    │   │ queueSync.js        │
│ tokenIssuance.js     │   │ durationAnalytics.js   │   │ BroadcastChannel    │
│ adminDispatch.js     │   │ Stage A Baseline       │   │ storage Fallback    │
│ Pure FSM Validators  │   │ Stage B Rolling Avg    │   │ visibilitychange    │
└───────┬──────────────┘   └───────────┬────────────┘   └─────────────┬───────┘
        │                              │                              │
        └──────────────────────────────┼──────────────────────────────┘
                                       │ Fail-Closed Persistence
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                             PERSISTENCE LAYER                               │
│                                 storage.js                                  │
│             Browser localStorage ('queueless_state_v1')                     │
│            Schema Validation • JSON Parse Recovery • Quota Guards           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Technology Matrix

| Technology | Version / Specification | Rationale |
| :--- | :--- | :--- |
| **React** | `v18.3.1` | Declarative UI rendering, predictable state hooks (`useState`, `useEffect`, `useCallback`, `useRef`), and minimal runtime overhead. |
| **Vite** | `v6.4.5` | Instant HMR development server and lightning-fast Rollup-based production bundling. |
| **JavaScript** | ES2022 (Modern Standard) | Native browser features (optional chaining, nullish coalescing, structured cloning). |
| **CSS Architecture** | Vanilla CSS Variables | Zero-dependency design system tokens, responsive CSS grid, glassmorphic dark-mode surfaces. |
| **Storage Engine** | Browser `localStorage` | Client-side durable persistence across browser reloads without external databases. |
| **Inter-Tab Sync** | Native `BroadcastChannel` | Sub-millisecond peer notification bus across same-origin tabs. |
| **Test Framework** | Node.js Built-in `node:test` | Zero external testing framework dependencies; sub-second test execution. |

---

## 3. Key Features by Phase

* **Phase 2 — Foundation & UI Scaffolding:** Dark-mode glassmorphic theme, responsive mobile-friendly layout, navigation hash synchronization (`window.location.hash`), and approved service desk catalog.
* **Phase 3.1 — Queue State Model & Storage Adapter:** Strict FSM state model, monotonic sequence counter starting at `001`, durable schema validation, and multi-tier recovery from corrupted JSON or private browsing quotas.
* **Phase 3.2 — Customer Token Issuance & Session Management:** Single-active-token session rule (`queueless_active_token_id_v1`), service pause checking, fail-closed persistence guarantees, and client-side input sanitization.
* **Phase 4A — Queue-Position & Stage A Wait Estimation:** Strict FIFO ordering with tie-breaking, separation between position $P$ and ahead count $N_{\text{ahead}}$, two-branch Stage A baseline wait formula, and explicit zero-wait readiness wording.
* **Phase 4B — Administrator Queue-Dispatcher:** Call Next with counter occupancy prevention, Complete and Skip actions with timestamp recording, fair tail-append re-queuing, intake pausing, and isolated single-service resets.
* **Phase 5A — Cross-Tab Synchronization & State Consistency:** Real-time multi-tab state propagation via `BroadcastChannel`, anti-echo loop filtering, non-PII notification payloads, tri-event fallback (`storage`, `focus`, `visibilitychange`), and monotonic version comparison.
* **Phase 5B — Stage B Adaptive Estimation (Rolling Average):** Service duration measurement $((completedAt - calledAt) / 60000)$, durational clamping $[1.0, 20.0]$ minutes, arithmetic mean of newest $M \le 5$ completed samples, transparent fallback when $M = 0$, and UI disclosure badges.
* **Phase 6A — System-Wide QA & Reliability Hardening:** 115-test regression suite, cancelled ticket timestamp semantic fix, input length boundary enforcement, WCAG AA `:focus-visible` keyboard accessibility, and production verification.

---

## 4. Project Structure

```
QueueLess/
├── docs/
│   ├── prompt-book.md              # Complete chronological prompt history & 38 architectural decisions
│   ├── requirements.md             # System Requirements Specification (SRS Version 1.2.0)
│   └── test-cases.md               # 33 formal acceptance test specifications
├── public/                         # Static web assets
├── src/
│   ├── components/                 # Reusable React UI components
│   │   ├── Badge.jsx               # Visual status and service prefix pill tags
│   │   ├── Navbar.jsx              # Responsive header navigation with hash view routing
│   │   └── ServiceCard.jsx         # Service catalog presentation card
│   ├── hooks/                      # Custom React hooks
│   │   └── useQueue.js             # Central queue orchestrator, storage sync, and lifecycle hook
│   ├── pages/                      # Top-level view controllers
│   │   ├── AdminPage.jsx           # Desk counter dispatch controls and Stage B analytics panel
│   │   ├── HomePage.jsx            # Service catalogue and digital token issuance modal
│   │   └── TrackerPage.jsx         # Customer digital ticket tracker with adaptive wait times
│   ├── styles/                     # Design system tokens and layout styles
│   │   └── index.css               # Vanilla CSS design tokens, glassmorphism, and WCAG focus states
│   ├── utils/                      # Pure functional domain modules
│   │   ├── adminDispatch.js        # Desk counter dispatch operations (Call, Complete, Skip, Re-queue)
│   │   ├── durationAnalytics.js    # Historical completed service duration extraction & rolling average
│   │   ├── estimationEngine.js     # Queue position, Stage A baseline, and Stage B adaptive models
│   │   ├── queueModel.js           # Core FSM state factory, schema validator, and transition engine
│   │   ├── queueSync.js            # BroadcastChannel bus, cross-tab events, and multi-tier fallbacks
│   │   ├── services.js             # Approved academic service catalog definition and formatting
│   │   ├── storage.js              # LocalStorage persistence adapter with fault-tolerant recovery
│   │   └── tokenIssuance.js        # Customer token generation and session token reference enforcement
│   ├── App.jsx                     # Top-level application shell and view router
│   └── main.jsx                    # React DOM entry point
├── test/                           # Automated regression test suites (Node.js test runner)
│   ├── phase3_1_state_and_storage.test.js      # 11 tests: state model, schema, storage recovery
│   ├── phase3_2_token_issuance.test.js         # 10 tests: issuance rules, session token enforcement
│   ├── phase4_a_queue_and_estimation.test.js   # 12 tests: FIFO ordering, Stage A baseline wait
│   ├── phase4_b_admin_dispatch.test.js         # 16 tests: counter dispatch, re-queue, pause, reset
│   ├── phase5_a_cross_tab_sync.test.js         # 19 tests: BroadcastChannel, versioning, anti-loop
│   ├── phase5_b_adaptive_estimation.test.js    # 20 tests: Stage B rolling average, clamping, fallback
│   └── phase6_a_system_qa.test.js              # 27 tests: system-wide QA, edge cases, invariants
├── index.html                      # HTML5 single-page application document
├── package.json                    # Project metadata, scripts, and dependencies
└── README.md                       # Comprehensive system documentation
```

---

## 5. State Management & Storage Design

QueueLess enforces a single source of truth stored in browser `localStorage` under the key `queueless_state_v1`:

```json
{
  "version": 42,
  "lastUpdatedAt": 1730000000000,
  "sequenceCounters": {
    "admissions": 5,
    "finance": 3,
    "examinations": 12
  },
  "serviceStatuses": {
    "admissions": "ACTIVE",
    "finance": "PAUSED",
    "examinations": "ACTIVE"
  },
  "tokens": [
    {
      "id": "tok_1730000000000_adm1",
      "tokenNumber": "ADM-001",
      "serviceId": "admissions",
      "serviceName": "Admissions & Enrollment",
      "customerName": "Alice M.",
      "status": "COMPLETED",
      "createdAt": 1730000000000,
      "calledAt": 1730000060000,
      "completedAt": 1730000240000,
      "skippedAt": null,
      "cancelledAt": null,
      "estimatedWaitMinutes": 5,
      "requeueCount": 0
    }
  ]
}
```

### Storage Resilience Guarantees

1. **Schema Validation (`validateQueueState`):** Every read and write validates types, non-negative sequence counters, approved statuses, and token structures.
2. **Corrupted JSON Recovery:** If storage contains malformed JSON or invalid syntax, `loadQueueState` catches the exception, logs a warning, and initializes a clean approved state (`source: 'fallback_malformed'`).
3. **Private Browsing & Quota Handling:** If `localStorage.setItem` throws `QuotaExceededError` or browser security blocks storage, the adapter returns `{ success: false, error }` without crashing React.
4. **Session Token Isolation:** Active session token ID is stored separately under `queueless_active_token_id_v1`. On counter reset or token completion/cancellation, the session reference is cleanly disassociated.

---

## 6. Queue Lifecycle State Machine

The token lifecycle strictly models the physical reality of service desks using a finite state machine:

```
                  ┌──────────────────────┐
                  │       WAITING        │ ◄──────────────────────┐
                  └──────────┬───────────┘                        │
                             │                                    │
               ┌─────────────┴─────────────┐                      │
               │                           │                      │
       Customer Cancels             Admin Calls Next         Re-queue
               │                           │               (Tail Append)
               ▼                           ▼                      │
       ┌───────────────┐           ┌───────────────┐              │
       │   CANCELLED   │           │    SERVING    │              │
       │  (Terminal)   │           └───────┬───────┘              │
       └───────────────┘                   │                      │
                             ┌─────────────┴─────────────┐        │
                             │                           │        │
                       Admin Completes              Admin Skips   │
                             │                     (Customer Absent)
                             ▼                           │        │
                     ┌───────────────┐                   ▼        │
                     │   COMPLETED   │           ┌───────────────┴┐
                     │  (Terminal)   │           │    SKIPPED     │
                     └───────────────┘           └────────────────┘
```

### Lifecycle Transition Rules

| Transition | Permitted Precondition | Side Effects & Timestamp Recording |
| :--- | :--- | :--- |
| `WAITING → SERVING` | Service counter must be vacant (no other token SERVING for this service). | Records `calledAt = timestamp`. Customer prompted to proceed to counter. |
| `WAITING → CANCELLED` | Allowed at any time while in WAITING status. | Records `cancelledAt = timestamp`. Clears active browser session. |
| `SERVING → COMPLETED` | Token must currently be SERVING at this service counter. | Records `completedAt = timestamp`, clears `skippedAt = null`. Frees counter; eligible for Stage B analytics. |
| `SERVING → SKIPPED` | Token must currently be SERVING at this service counter. | Records `skippedAt = timestamp`, clears `completedAt = null`. Frees counter; excluded from Stage B analytics. |
| `SKIPPED → WAITING` | Token must currently be in SKIPPED status. | Re-queue appends to tail: sets `createdAt = timestamp`, clears `calledAt/completedAt/skippedAt`, increments `requeueCount`. |
| Terminal States | `COMPLETED` and `CANCELLED` are terminal. | No further transitions permitted. |

---

## 7. Waiting-Time Estimation Engine

QueueLess implements a staged waiting-time estimation model combining deterministic queue-depth calculation with adaptive statistical learning.

### Definitions & Positioning

* **$N_{\text{ahead}}$ (Tokens Ahead):** Count of eligible `WAITING` tokens preceding the target token for the same service, sorted by FIFO priority (`createdAt` ascending, with `id` tie-breaking).
* **$P$ (Ordinal Position):** $P = N_{\text{ahead}} + 1$. For a customer currently being served, $P = \text{"Now Serving"}$.

### Stage A: Baseline Estimation Model

Stage A uses an approved static baseline duration $T_{\text{baseline}}$ configured per service:
* **Admissions & Enrollment (ADM):** $T_{\text{baseline}} = 5\text{ minutes}$
* **Student Accounts & Finance (FIN):** $T_{\text{baseline}} = 3\text{ minutes}$
* **Examinations & Records (EXM):** $T_{\text{baseline}} = 6\text{ minutes}$

$$\text{EstimatedWait} = \begin{cases} 
\text{RemainingCurrentService} + (N_{\text{ahead}} \times T_{\text{baseline}}), & \text{if a customer is currently SERVING} \\ 
N_{\text{ahead}} \times T_{\text{baseline}}, & \text{if counter is VACANT} 
\end{cases}$$

$$\text{RemainingCurrentService} = \max(0, T_{\text{baseline}} - \text{ElapsedServingMinutes})$$

### Stage B: Adaptive Rolling-Average Model

Stage B learns from historical completed service durations. A token is eligible for historical analytics if and only if:
1. `status === 'COMPLETED'`
2. `calledAt` and `completedAt` are valid numbers $> 0$
3. `completedAt > calledAt`
4. `serviceId` belongs to the approved catalog

The raw transaction duration is clamped to eliminate statistical outliers (e.g. quick miss-clicks or abandoned desks):

$$d = \min\left(20.0, \, \max\left(1.0, \, \frac{\text{completedAt} - \text{calledAt}}{60000}\right)\right)$$

The adaptive duration $T_{\text{average}}$ is the unweighted arithmetic mean of the newest $M \le 5$ completed transactions:

$$T_{\text{average}} = \frac{1}{M} \sum_{i=1}^{M} d_i \quad (M \le 5)$$

$$\text{EffectiveDuration} = \begin{cases} 
T_{\text{average}}, & \text{if } M \ge 1 \quad (\text{Stage B Adaptive}) \\ 
T_{\text{baseline}}, & \text{if } M = 0 \quad (\text{Stage A Fallback}) 
\end{cases}$$

### Zero-Wait Semantics

When $N_{\text{ahead}} = 0$ and the counter is vacant:
* **Wait Time:** $0\text{ min}$
* **Status Wording:** `"You are next in line — Counter is ready to call you"`
* **Academic Guarantee:** Indicates desk readiness for immediate call, not instant completion of the customer's transaction.

---

## 8. Cross-Tab Synchronization Architecture

To support realistic multi-window demonstrations (e.g. customer tab on one half of the screen and admin counter on the other), QueueLess synchronizes state changes using an event-driven architecture:

```
[ Tab A: Admin Page ]                       [ Tab B: Customer Tracker ]
        │                                               │
   Dispatches Call Next                                 │
        │                                               │
  1. Writes state to localStorage                       │
     (version = 14)                                     │
        │                                               │
  2. Broadcasts Sync Event                              │
     { type: 'TOKEN_CALLED', version: 14 }              │
        │                                               │
        ├──────────────── BroadcastChannel ────────────►│
        │           ('queueless_queue_sync_v1')         │
        │                                               │ 3. Receives event
        │                                               │ 4. Reads canonical storage
        │                                               │ 5. Compares version: 14 > 13
        │                                               │ 6. React state updates
        │                                               │    (Customer sees Now Serving!)
```

### Concurrency Guarantees & Fallbacks

* **Monotonic Version Comparison:** Incoming state is accepted if and only if `candidateState.version > currentState.version`, preventing stale message rollbacks.
* **Anti-Looping Invariant:** Every browser tab generates a stable `originId` (`tab_<time>_<rand>`). Incoming messages where `message.originId === tab.originId` are silently discarded.
* **Zero-PII Wire Invariant:** Broadcast messages contain strictly non-PII metadata (`type`, `version`, `timestamp`, `originId`, `serviceId`). Customer names and token lists are never broadcast.
* **Tri-Event Fallback:** When `BroadcastChannel` is not supported (e.g. legacy browsers or sandboxes), the sync module falls back to `window.addEventListener('storage')`, supplemented by `window.addEventListener('focus')` and `document.addEventListener('visibilitychange')`.
* **Honest Concurrency Boundary:** Browser `localStorage` lacks distributed locking and Compare-And-Swap (CAS) primitives. Under concurrent writes at the exact same millisecond, last-write-wins applies.

---

## 9. Getting Started / Local Development

### Prerequisites

* **Node.js:** v18.0.0 or later (v20+ or v24+ recommended)
* **npm:** v9.0.0 or later

### Installation & Launch

1. Clone or extract the repository:
   ```bash
   cd QueueLess
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the Vite local development server:
   ```bash
   npm run dev
   ```

4. Open `http://localhost:5173` in your browser.

### Multi-Tab Live Demonstration Procedure

1. Open **Tab 1** at `http://localhost:5173/#/home` (Customer View).
2. Open **Tab 2** at `http://localhost:5173/#/admin` (Admin View).
3. In **Tab 1**, select **Admissions & Enrollment** and click **Request Queue Token**.
4. Observe **Tab 2**: Admissions counter instantly displays the new waiting customer in FIFO order.
5. In **Tab 2**, click **Call Next Customer**.
6. Observe **Tab 1**: Digital ticket transitions immediately to vibrant green **Now Serving** with counter directions!

---

## 10. Running Automated Tests

QueueLess uses the native Node.js test runner (`node:test`) and assertion library (`node:assert/strict`), ensuring instant execution without external test framework bloat.

### Execute All Regression Tests

```bash
npm test
```

### Test Suite Summary

```
✔ test/phase3_1_state_and_storage.test.js      (11 tests passed)
✔ test/phase3_2_token_issuance.test.js         (10 tests passed)
✔ test/phase4_a_queue_and_estimation.test.js   (12 tests passed)
✔ test/phase4_b_admin_dispatch.test.js         (16 tests passed)
✔ test/phase5_a_cross_tab_sync.test.js         (19 tests passed)
✔ test/phase5_b_adaptive_estimation.test.js    (20 tests passed)
✔ test/phase6_a_system_qa.test.js              (27 tests passed)

Total Tests: 115 passing, 0 failing, 0 skipped
Execution Time: ~560 ms
```

---

## 11. Quality Assurance, Reliability Hardening & Phase 6B Validation

### Phase 6A Hardening Findings & Fixes

Phase 6A performed an exhaustive system-wide audit across all layers. The following defects and edge cases were identified, resolved, and locked with regression tests:

1. **Cancelled Token Timestamp Anomaly:**
   * *Finding:* In `queueModel.js`, applying the `CANCELLED` transition erroneously set `completedAt = timestamp`.
   * *Resolution:* Corrected to set `cancelledAt = timestamp` while ensuring `completedAt = null`. Preserves semantic integrity: cancelled tokens are customer withdrawals, not completed services.
2. **Customer Name Input Boundary & Sanitization:**
   * *Finding:* Potential DOM bloat and storage saturation if oversized string payloads were submitted.
   * *Resolution:* Added `maxLength={80}` in `HomePage.jsx` and pure string truncation `customerName.trim().slice(0, 80)` in `createToken`.
3. **Accessibility (WCAG AA) & Keyboard Focus Indicators:**
   * *Finding:* Missing `:focus-visible` outline styles for keyboard navigation.
   * *Resolution:* Implemented high-contrast `2px solid var(--accent-cyan)` outlines with `outline-offset: 2px` on all buttons, inputs, and interactive surfaces.
4. **Modal Dialog Screen Reader Semantics:**
   * *Finding:* Service request modal lacked ARIA dialog attributes and close button label.
   * *Resolution:* Added `role="dialog"`, `aria-modal="true"`, `aria-labelledby="modal-request-token-title"`, and `aria-label="Close modal dialog"`.
5. **Session Disassociation Safety:**
   * *Finding:* Risk of old sessions attaching to newly issued tokens with identical formatted numbers (e.g. `ADM-001`) after a service reset.
   * *Resolution:* Verified session matching uses globally unique `token.id` strings (`tok_<timestamp>_<prefix><seq>`), strictly preventing ticket hijacking.

### Phase 6B Validation & Responsive Enhancements

1. **Admin Dashboard Mobile Overflow:**
   * *Finding:* Inline `minmax(350px, 1fr)` caused horizontal overflow on smartphones ($320\text{px}$–$390\text{px}$).
   * *Resolution:* Refactored to `.admin-counters-grid` with `grid-template-columns: 1fr` override on screens $\le 768\text{px}$.
2. **WCAG AA Muted Text Contrast Elevation:**
   * *Finding:* `--text-muted` at `#6b7280` had contrast of $3.96:1$, falling short of the $4.5:1$ threshold.
   * *Resolution:* Elevated to `#94a3b8` (Slate 400), achieving $7.1:1$ contrast against `#0b0f19`.
3. **Ultra-Compact Display Adaptation:**
   * *Finding:* $320\text{px}$ viewport experienced tight margins and navbar badge wrapping.
   * *Resolution:* Added `@media (max-width: 480px)` rules adjusting content padding to $0.85\text{rem}$ and hiding non-critical badge chips.

---

## 12. Testing Methodology & Evidence Classification

QueueLess adheres to strict academic evaluation standards by explicitly differentiating testing modalities:

| Testing Modality | Method & Environment | Coverage Scope | Status & Result |
| :--- | :--- | :--- | :--- |
| **Automated Unit Testing** | Node.js `node:test` + `node:assert/strict` | Pure domain logic: `queueModel.js`, `durationAnalytics.js`, `estimationEngine.js`. | **115 / 115 Passed** (576 ms) |
| **Integration Simulation** | In-Memory `MockBroadcastChannelBus` & Mock Storage | Cross-tab synchronization, race condition suppression, monotonic version ordering. | **Verified** (19 sync tests) |
| **Static Viewport Inspection** | CSS Grid & Media Query Analysis | Responsive layouts across 320px, 390px, 768px, 1280px, 1440px, and 1920px. | **Verified** (Zero overflow) |
| **Contrast Ratio Measurement** | KaTeX Relative Luminance Calculation | Color palette contrast against WCAG AA ($4.5:1$) and AAA ($7.0:1$) standards. | **Verified** ($6.96:1$ to $17.36:1$) |
| **Headless Browser Automation** | Headless Chrome / Edge CLI | Direct automated GUI screenshot generation. | *Restricted by Windows Sandbox* |
| **Manual Live Browser Verification** | Human Evaluator in Chrome / Edge / Firefox | Two-tab live interaction, URL hash routing, refresh persistence. | **Demonstration Ready** |

---

## 13. Academic Demonstration Script (5–7 Minute ESE Presentation)

This sequence is designed for a live evaluation before examiners:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       5-MINUTE LIVE ESE DEMONSTRATION                        │
├──────┬───────────────────────┬──────────────────────────────────────────────┤
│ TIME │ STEP                  │ ACTIONS & EXPLANATION                        │
├──────┼───────────────────────┼──────────────────────────────────────────────┤
│ 0:00 │ Problem Statement     │ Open Tab A (Customer) & Tab B (Admin).       │
│      │ & Architecture        │ Explain physical queue inefficiency and why  │
│      │                       │ local-first reactive web architecture solves │
│      │                       │ it without cloud backend costs.              │
├──────┼───────────────────────┼──────────────────────────────────────────────┤
│ 1:00 │ Customer Token        │ Tab A: Select Admissions, enter "Alex M.".   │
│      │ Issuance & FIFO       │ Click Request Token -> receives ADM-001.     │
│      │                       │ Explain deterministic FIFO queue sequence.   │
├──────┼───────────────────────┼──────────────────────────────────────────────┤
│ 2:00 │ Live Tracker &        │ Tab A transitions to Live Tracker.           │
│      │ Zero-Wait Semantics   │ Show "#1 in line", "0 min (Ready now)".      │
│      │                       │ Explain zero-wait readiness vs service time. │
├──────┼───────────────────────┼──────────────────────────────────────────────┤
│ 3:00 │ Real-Time Multi-Tab   │ Tab B: Instant update shows ADM-001 waiting. │
│      │ Broadcast Sync        │ Explain BroadcastChannel event dispatch and  │
│      │                       │ single source of truth in localStorage.      │
├──────┼───────────────────────┼──────────────────────────────────────────────┤
│ 4:00 │ Counter Dispatch      │ Tab B: Click Call Next Customer.             │
│      │ & Live State Update   │ Tab A instantly turns green: "Now Serving"!  │
│      │                       │ Tab B: Click Complete after transaction.     │
├──────┼───────────────────────┼──────────────────────────────────────────────┤
│ 5:00 │ Stage B Adaptive      │ Tab B: Show Stage B Analytics panel.         │
│      │ Rolling Average       │ Explain arithmetic mean of M <= 5 completed  │
│      │                       │ transactions and clamping to [1, 20] min.    │
│      │                       │ Emphasize: statistical mean, NOT an ML model.│
├──────┼───────────────────────┼──────────────────────────────────────────────┤
│ 6:00 │ Desk Management       │ Tab B: Demonstrate Pause Intake (Tab A blocks│
│      │ & Resilience          │ issuance), Resume, and Reset Service.        │
│      │                       │ Show other service counters remain intact.   │
└──────┴───────────────────────┴──────────────────────────────────────────────┘
```

---

## 14. ESE Visual Evidence Checklist

For the project report and examination slides, capture the following 14 views:

1. **Homepage Hero & Service Catalog:** `#/home` showing all 3 service counters and active queue counters.
2. **Service Request Dialog:** Modal showing expected token sequence number, baseline duration, and customer name input.
3. **Active Session Restriction Banner:** Alert banner preventing a user from holding two active tickets simultaneously.
4. **Live Digital Ticket Tracker (Waiting):** Ticket card showing `#P in line`, waiting ahead count, and baseline wait.
5. **Ready-Now Status Display:** Zero-wait state showing `"0 min (Ready now)"` when counter is vacant.
6. **Now Serving Screen:** Vibrant emerald banner displaying active counter call and arrival directions.
7. **Service Completed Screen:** Terminal confirmation with recorded completion timestamp.
8. **Skipped Customer Screen:** Amber warning notice guiding absentee customers to counter staff.
9. **Administrator Counter Overview:** `#/admin` displaying all 3 counters, vacancy status, and FIFO waiting queues.
10. **Counter Action Controls:** Call Next, Complete, and Skip buttons with occupancy prevention.
11. **Stage B Duration Analytics Panel:** Showing baseline, rolling average duration, sample count, and data sufficiency tag.
12. **Desk Intake Pause Alert:** Paused badge and disabled issuance state.
13. **Two-Window Synchronized View:** Split-screen showing Tab A (Tracker) reacting to Tab B (Admin) dispatch.
14. **Ultra-Compact Mobile Layout ($320\text{px}$):** Mobile view showing fluid single-column cards with zero horizontal clipping.

---

## 15. Architectural Limitations & Future Roadmap

To uphold rigorous academic integrity, the known boundaries of this local-first prototype are documented transparently:

* **No Distributed Multi-Writer Locking:** Browser `localStorage` does not support distributed ACID transactions. Concurrent mutations from two tabs at the same millisecond follow last-write-wins.
* **Single-Origin Boundary:** `BroadcastChannel` and `localStorage` are bounded to a single browser origin (`protocol://domain:port`). Synchronization across physically separate smartphones requires a server-side backend.
* **Future Production Roadmap:**
  * Backend migration to Node.js / Go with PostgreSQL transactions (`SELECT ... FOR UPDATE`).
  * Real-time WebSocket / Server-Sent Events (SSE) dispatch channel.
  * Push Notification API and Web SMS integration for mobile background alerts.
  * Multi-counter parallel dispatch for high-capacity service desks.

---

## 16. Academic Context & Submission Details

* **Project Name:** QueueLess — Smart Queue Management & Waiting-Time Estimation System
* **Academic Course:** Bachelor of Technology in Computer Science & Engineering (Artificial Intelligence & Machine Learning)
* **Semester:** 3rd Semester End Semester Examination
* **Evaluation Criteria Satisfied:**
  1. *FSM State Machine Design:* Formally defined states, explicit transition guards, and immutable updates.
  2. *Data Analytics:* Rolling-average statistical estimation engine with clamping and data sufficiency metrics.
  3. *Distributed Reactive Systems:* Event-driven cross-tab synchronization via `BroadcastChannel` with multi-tier fallback.
  4. *Software Reliability Engineering:* 115 automated unit and integration tests passing in sub-second execution.
  5. *Accessibility & Clean Code:* Semantic HTML5, WCAG AA compliance, and modular JavaScript with zero framework bloat.
