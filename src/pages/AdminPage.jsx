import React, { useState } from 'react';
import { APPROVED_SERVICES } from '../utils/services.js';
import Badge from '../components/Badge.jsx';
import { getServiceQueue, calculateStageBWaitTime, calculateRollingAverage } from '../utils/estimationEngine.js';

/**
 * AdminPage: Administrator Counter Dashboard
 * Phase 4B & 5B: Live queue dispatch controls and Stage B rolling average duration analytics.
 *
 * Guarantees:
 * - State and persistence validation enforced through useQueue hook.
 * - Call Next unavailable while counter is occupied or waiting queue is empty.
 * - Complete and Skip available only for currently serving token.
 * - Re-queue available only for eligible SKIPPED tokens.
 * - Destructive resets require explicit confirmation.
 * - Non-interference: actions on one service do not mutate other services.
 * - Stage B rolling average derived purely from completed tokens with valid timestamps.
 */
export default function AdminPage({
  queueState,
  serviceAnalytics,
  onCallNext,
  onCompleteServing,
  onSkipServing,
  onRequeue,
  onTogglePause,
  onResetService,
  onResetAll
}) {
  const [resetServiceConfirmId, setResetServiceConfirmId] = useState(null);
  const [showResetAllConfirm, setShowResetAllConfirm] = useState(false);
  const [actionFeedback, setActionFeedback] = useState(null);

  const showNotification = (msg, isError = false) => {
    setActionFeedback({ message: msg, isError });
    setTimeout(() => {
      setActionFeedback((curr) => (curr?.message === msg ? null : curr));
    }, 4000);
  };

  const handleCallNext = (serviceId, serviceName) => {
    const res = onCallNext(serviceId);
    if (res?.success) {
      showNotification(`Called customer ${res.token.tokenNumber} to ${serviceName} counter.`);
    }
  };

  const handleCompleteServing = (serviceId, tokenNumber) => {
    const res = onCompleteServing(serviceId);
    if (res?.success) {
      showNotification(`Customer ${tokenNumber} marked COMPLETED.`);
    }
  };

  const handleSkipServing = (serviceId, tokenNumber) => {
    const res = onSkipServing(serviceId);
    if (res?.success) {
      showNotification(`Customer ${tokenNumber} marked SKIPPED (absent / no-show).`);
    }
  };

  const handleRequeue = (tokenId, tokenNumber) => {
    const res = onRequeue(tokenId);
    if (res?.success) {
      showNotification(`Customer ${tokenNumber} re-queued to the tail of the waiting line.`);
    }
  };

  const handleTogglePause = (serviceId, serviceName) => {
    const res = onTogglePause(serviceId);
    if (res?.success) {
      showNotification(`${serviceName} intake is now ${res.newStatus}.`);
    }
  };

  const handleConfirmResetService = (serviceId, serviceName) => {
    const res = onResetService(serviceId);
    if (res?.success) {
      showNotification(`Reset ${serviceName} queue and sequence counter back to 000.`);
    }
    setResetServiceConfirmId(null);
  };

  const handleConfirmResetAll = () => {
    const res = onResetAll();
    if (res?.success) {
      showNotification(`All service queues and counters have been reset to 000.`);
    }
    setShowResetAllConfirm(false);
  };

  return (
    <div className="admin-page">
      {/* Top Header & Master Reset Control */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '2rem' }}>
        <div>
          <h2>Administrator Counter Dashboard</h2>
          <p style={{ fontSize: '0.925rem', color: 'var(--text-secondary)' }}>
            Real-time queue depth, FIFO order dispatching, and Stage A baseline wait estimates.
          </p>
        </div>

        {/* Global Reset All Action */}
        <div>
          {showResetAllConfirm ? (
            <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: 'var(--radius-md)', padding: '0.65rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '0.825rem', color: '#fca5a5', fontWeight: '600' }}>
                Reset ALL counters to 0?
              </span>
              <button
                type="button"
                className="btn"
                style={{ background: '#ef4444', color: '#ffffff', fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
                onClick={handleConfirmResetAll}
              >
                Confirm Full Reset
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem', padding: '0.3rem 0.65rem' }}
                onClick={() => setShowResetAllConfirm(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-outline"
              style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', borderColor: 'var(--border-subtle)' }}
              onClick={() => setShowResetAllConfirm(true)}
              title="Reset all counters and clear all tokens across all services"
            >
              ⚙️ Reset All Queues
            </button>
          )}
        </div>
      </div>

      {/* Action Feedback Banner */}
      {actionFeedback && (
        <aside
          role="status"
          aria-live="polite"
          style={{
            background: actionFeedback.isError ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
            border: actionFeedback.isError ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid rgba(16, 185, 129, 0.35)',
            color: actionFeedback.isError ? '#f87171' : '#34d399',
            padding: '0.6rem 1.25rem',
            borderRadius: 'var(--radius-md)',
            marginBottom: '1.5rem',
            fontSize: '0.875rem',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <span>{actionFeedback.isError ? '🛑' : '✓'} {actionFeedback.message}</span>
          <button
            type="button"
            aria-label="Dismiss feedback"
            onClick={() => setActionFeedback(null)}
            style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '0.9rem' }}
          >
            ✕
          </button>
        </aside>
      )}

      {/* Counters Status Grid */}
      <div className="admin-counters-grid">
        {APPROVED_SERVICES.map((service) => {
          const { servingToken, waitingTokens } = getServiceQueue(queueState, service.id);
          const totalIssued = queueState?.sequenceCounters?.[service.id] || 0;
          const isPaused = queueState?.serviceStatuses?.[service.id] === 'PAUSED';

          // Identify skipped tokens for this service
          const skippedTokens = Array.isArray(queueState?.tokens)
            ? queueState.tokens.filter((t) => t.serviceId === service.id && t.status === 'SKIPPED')
            : [];

          const isConfirmingReset = resetServiceConfirmId === service.id;

          const analytics = (serviceAnalytics && serviceAnalytics[service.id])
            ? serviceAnalytics[service.id]
            : calculateRollingAverage(service.id, queueState);

          return (
            <div key={service.id} className="glass-card" style={{ display: 'flex', flexDirection: 'column' }}>
              {/* Header Badges */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <Badge variant="prefix">{service.prefix}</Badge>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <Badge variant={isPaused ? 'waiting' : 'serving'}>
                    {isPaused ? 'Intake Paused' : 'Intake Active'}
                  </Badge>
                </div>
              </div>

              {/* Service Info */}
              <h3 style={{ fontSize: '1.2rem', marginBottom: '0.25rem' }}>
                {service.name}
              </h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
                {service.counterNumber} • Baseline: {service.baselineDurationMinutes} min • Issued: <strong>{totalIssued}</strong>
              </p>

              {/* Now Serving Status & Counter Controls */}
              <div
                style={{
                  background: servingToken ? 'rgba(16, 185, 129, 0.08)' : 'var(--bg-glass)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem',
                  border: servingToken ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid var(--border-subtle)',
                  marginBottom: '1.25rem'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
                    Counter Status
                  </span>
                  <span className="mono" style={{ color: servingToken ? '#34d399' : 'var(--text-secondary)', fontWeight: '700', fontSize: '0.95rem' }}>
                    {servingToken ? `SERVING ${servingToken.tokenNumber}` : 'VACANT'}
                  </span>
                </div>

                {servingToken ? (
                  <div>
                    <div style={{ marginBottom: '0.75rem' }}>
                      <div className="mono" style={{ fontSize: '1.6rem', fontWeight: '800', color: '#ffffff' }}>
                        {servingToken.tokenNumber}
                      </div>
                      {servingToken.customerName && (
                        <div style={{ fontSize: '0.85rem', color: '#a5b4fc' }}>
                          Customer: <strong>{servingToken.customerName}</strong>
                        </div>
                      )}
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                        Called at: {new Date(servingToken.calledAt || Date.now()).toLocaleTimeString()}
                      </div>
                    </div>

                    {/* Active Serving Action Buttons */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                      <button
                        type="button"
                        className="btn"
                        style={{
                          background: '#10b981',
                          color: '#ffffff',
                          fontSize: '0.825rem',
                          padding: '0.55rem',
                          fontWeight: '600'
                        }}
                        onClick={() => handleCompleteServing(service.id, servingToken.tokenNumber)}
                        title="Complete active customer and free the counter"
                      >
                        ✓ Complete
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline"
                        style={{
                          color: '#f59e0b',
                          borderColor: 'rgba(245, 158, 11, 0.4)',
                          fontSize: '0.825rem',
                          padding: '0.55rem'
                        }}
                        onClick={() => handleSkipServing(service.id, servingToken.tokenNumber)}
                        title="Mark customer as skipped / absentee and free counter"
                      >
                        ↷ Skip (No-Show)
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                      Counter is ready. {waitingTokens.length > 0 ? `${waitingTokens.length} customer(s) waiting in line.` : 'No customers waiting.'}
                    </p>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ width: '100%', fontSize: '0.9rem', padding: '0.6rem' }}
                      disabled={waitingTokens.length === 0}
                      onClick={() => handleCallNext(service.id, service.name)}
                      title={waitingTokens.length === 0 ? 'Queue is empty. No customers to call.' : `Call next waiting ticket: ${waitingTokens[0]?.tokenNumber}`}
                    >
                      ▶ Call Next Customer
                    </button>
                  </div>
                )}
              </div>

              {/* FIFO Waiting Queue */}
              <div style={{ marginBottom: '1.25rem', flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                    Waiting Queue (FIFO Order)
                  </span>
                  <span className="mono" style={{ fontSize: '0.8rem', color: 'var(--accent-cyan)', fontWeight: '700' }}>
                    {waitingTokens.length} in line
                  </span>
                </div>

                {waitingTokens.length === 0 ? (
                  <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '1rem', textAlign: 'center' }}>
                    <p style={{ fontSize: '0.825rem', color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>
                      No tickets currently waiting in line.
                    </p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '180px', overflowY: 'auto' }}>
                    {waitingTokens.map((t, idx) => {
                      const waitEstimate = calculateStageBWaitTime(t, queueState);
                      return (
                        <div
                          key={t.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            background: 'rgba(255, 255, 255, 0.03)',
                            border: '1px solid var(--border-subtle)',
                            padding: '0.45rem 0.75rem',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: '0.825rem'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ color: '#fbbf24', fontWeight: '700' }}>#{idx + 1}</span>
                            <span className="mono" style={{ color: '#ffffff', fontWeight: '600' }}>{t.tokenNumber}</span>
                            {t.customerName && (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>({t.customerName})</span>
                            )}
                          </div>
                          <span className="mono" style={{ color: 'var(--accent-cyan)' }}>
                            {waitEstimate.displayText}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Skipped Tickets (If Any) */}
              {skippedTokens.length > 0 && (
                <div style={{ marginBottom: '1.25rem', background: 'rgba(245, 158, 11, 0.04)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: 'var(--radius-sm)', padding: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#fbbf24', fontWeight: '600' }}>
                      Skipped Customers ({skippedTokens.length})
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '120px', overflowY: 'auto' }}>
                    {skippedTokens.map((t) => (
                      <div
                        key={t.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          background: 'rgba(0, 0, 0, 0.2)',
                          padding: '0.35rem 0.6rem',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.8rem'
                        }}
                      >
                        <span className="mono" style={{ color: '#fbbf24', fontWeight: '600' }}>
                          {t.tokenNumber} {t.customerName ? `(${t.customerName})` : ''}
                        </span>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                          onClick={() => handleRequeue(t.id, t.tokenNumber)}
                          title="Re-queue ticket to tail of waiting line"
                        >
                          ↺ Re-queue
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Stage B Adaptive Estimation Analytics Panel */}
              <div 
                style={{ 
                  background: 'rgba(255, 255, 255, 0.02)', 
                  border: '1px solid var(--border-subtle)', 
                  borderRadius: 'var(--radius-sm)', 
                  padding: '0.75rem', 
                  marginBottom: '1.25rem' 
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem' }}>
                  <span style={{ fontSize: '0.725rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '700', letterSpacing: '0.05em' }}>
                    Stage B Duration Analytics
                  </span>
                  <Badge variant={analytics.isUsingFallback ? 'waiting' : 'serving'} style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem' }}>
                    {analytics.isUsingFallback ? 'Baseline Fallback' : 'Adaptive Rolling Avg'}
                  </Badge>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>Approved Baseline</span>
                    <span className="mono" style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                      {analytics.baselineMinutes} min
                    </span>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>Rolling Average (M ≤ 5)</span>
                    <span 
                      className="mono" 
                      style={{ 
                        fontSize: '0.9rem', 
                        fontWeight: '800', 
                        color: analytics.rollingAverageMinutes !== null ? '#34d399' : 'var(--text-secondary)' 
                      }}
                    >
                      {analytics.rollingAverageMinutes !== null ? `${analytics.rollingAverageMinutes} min` : 'None (No history)'}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  <span>
                    Valid Samples: <strong>{analytics.sampleCount}</strong> / {analytics.sampleWindow}
                  </span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    Data: <strong style={{ color: analytics.sampleCount >= 5 ? '#34d399' : analytics.sampleCount > 0 ? '#fbbf24' : 'var(--text-muted)' }}>{analytics.dataSufficiency}</strong>
                  </span>
                </div>

                {analytics.recentDurations.length > 0 && (
                  <div style={{ marginTop: '0.45rem', paddingTop: '0.4rem', borderTop: '1px dashed var(--border-subtle)', fontSize: '0.725rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Recent completed (newest first): </span>
                    <span className="mono" style={{ color: '#a5b4fc', fontWeight: '600' }}>
                      {analytics.recentDurations.map((d) => `${d}m`).join(', ')}
                    </span>
                  </div>
                )}
              </div>

              {/* Counter Management Controls (Pause & Reset) */}
              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.85rem', marginTop: 'auto' }}>
                {isConfirmingReset ? (
                  <div style={{ background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius-sm)', padding: '0.65rem', textAlign: 'center' }}>
                    <p style={{ fontSize: '0.785rem', color: '#fca5a5', marginBottom: '0.5rem' }}>
                      Reset {service.prefix} queue? (Clears tickets & resets to 000)
                    </p>
                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                      <button
                        type="button"
                        className="btn"
                        style={{ background: '#ef4444', color: '#ffffff', fontSize: '0.75rem', padding: '0.3rem 0.65rem' }}
                        onClick={() => handleConfirmResetService(service.id, service.name)}
                      >
                        Confirm Reset
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: '0.75rem', padding: '0.3rem 0.65rem' }}
                        onClick={() => setResetServiceConfirmId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="btn btn-outline"
                      style={{
                        flex: 1,
                        fontSize: '0.8rem',
                        padding: '0.45rem',
                        color: isPaused ? '#34d399' : 'var(--text-secondary)',
                        borderColor: isPaused ? 'rgba(52, 211, 153, 0.4)' : 'var(--border-subtle)'
                      }}
                      onClick={() => handleTogglePause(service.id, service.name)}
                    >
                      {isPaused ? '▶ Resume Intake' : '⏸ Pause Intake'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline"
                      style={{
                        fontSize: '0.8rem',
                        padding: '0.45rem 0.75rem',
                        color: 'var(--text-muted)',
                        borderColor: 'var(--border-subtle)'
                      }}
                      onClick={() => setResetServiceConfirmId(service.id)}
                      title={`Reset sequence counter and clear waiting line for ${service.name}`}
                    >
                      ↺ Reset
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Architectural Guarantee Note */}
      <div className="glass-card" style={{ background: 'rgba(99, 102, 241, 0.05)', borderColor: 'rgba(99, 102, 241, 0.2)' }}>
        <h4 style={{ color: '#a5b4fc', marginBottom: '0.5rem' }}>Phase 4B Dispatch Governance & Invariants</h4>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
          All counter transitions are executed through pure lifecycle validators with immutable state progression. Calling Next enforces FIFO order and single-serving-token counter invariants. Completing or skipping records ISO epoch timestamps with mutual exclusivity, and re-queuing appends tickets strictly to the queue tail to protect fairness.
        </p>
      </div>
    </div>
  );
}
