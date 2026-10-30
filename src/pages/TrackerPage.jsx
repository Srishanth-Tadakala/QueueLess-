import React, { useState } from 'react';
import Badge from '../components/Badge.jsx';

/**
 * TrackerPage: Customer Live Digital Ticket & Queue Position Tracker
 * Phase 4B: Live state synchronization reflecting dispatch actions:
 * - WAITING: Queue position (#P in line), waiting ahead count, Stage A baseline wait.
 * - SERVING: Vibrant green Now Serving state, suppressed waiting metrics.
 * - COMPLETED: Service completion banner, suppressed active waiting metrics.
 * - SKIPPED: Skipped/absent notice, counter re-queue guidance, suppressed waiting metrics.
 * - CANCELLED: Cancellation acknowledgment, option to browse services.
 */
export default function TrackerPage({
  activeToken,
  trackedToken,
  activeMetrics,
  onCancelToken,
  onDismissSession,
  onNavigateHome
}) {
  const [confirmCancel, setConfirmCancel] = useState(false);

  const displayToken = trackedToken || activeToken;

  if (!displayToken) {
    return (
      <div className="tracker-page" style={{ maxWidth: '640px', margin: '0 auto', textAlign: 'center' }}>
        <div style={{ marginBottom: '2rem' }}>
          <h2>Live Ticket Tracker</h2>
          <p style={{ fontSize: '0.925rem', color: 'var(--text-secondary)' }}>
            Real-time queue monitoring and digital ticket status.
          </p>
        </div>

        <div className="glass-card" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎫</div>
          <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>No Active Queue Ticket</h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', maxWidth: '420px', margin: '0 auto 1.75rem' }}>
            You do not currently hold an active queue ticket in this browser session. Select an academic service desk to join a virtual line.
          </p>
          <button 
            type="button" 
            className="btn btn-primary"
            onClick={onNavigateHome}
          >
            ← Browse Service Desks
          </button>
        </div>
      </div>
    );
  }

  const status = displayToken.status;
  const isWaiting = status === 'WAITING';
  const isServing = status === 'SERVING';
  const isCompleted = status === 'COMPLETED';
  const isSkipped = status === 'SKIPPED';
  const isCancelled = status === 'CANCELLED';

  const formattedCreatedAt = new Date(displayToken.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const handleCancelClick = () => {
    if (confirmCancel) {
      onCancelToken(displayToken.id);
      setConfirmCancel(false);
    } else {
      setConfirmCancel(true);
    }
  };

  const handleDismissAndHome = () => {
    if (onDismissSession) {
      onDismissSession();
    }
    onNavigateHome();
  };

  // Determine border accent color based on status
  let cardBorderColor = 'var(--primary)';
  if (isServing) cardBorderColor = '#10b981';
  else if (isCompleted) cardBorderColor = '#34d399';
  else if (isSkipped) cardBorderColor = '#f59e0b';
  else if (isCancelled) cardBorderColor = '#ef4444';

  return (
    <div className="tracker-page" style={{ maxWidth: '640px', margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <h2>Live Ticket Tracker</h2>
        <p style={{ fontSize: '0.925rem', color: 'var(--text-secondary)' }}>
          {isServing
            ? 'Your ticket has been called! Proceed to the counter.'
            : isCompleted
            ? 'Your service session has concluded.'
            : isSkipped
            ? 'Your ticket was skipped due to customer absence.'
            : isCancelled
            ? 'This ticket was cancelled.'
            : 'Monitor your exact queue position and baseline estimated wait time.'}
        </p>
      </div>

      {/* Digital Ticket Card */}
      <div 
        className="glass-card" 
        style={{ 
          borderTop: `4px solid ${cardBorderColor}`, 
          position: 'relative',
          boxShadow: 'var(--shadow-lg)'
        }}
      >
        {/* Ticket Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px dashed var(--border-medium)', paddingBottom: '1.25rem' }}>
          <div>
            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              Your Digital Ticket
            </span>
            <div className="mono" style={{ fontSize: '2.5rem', fontWeight: '800', color: '#ffffff', letterSpacing: '-0.02em' }}>
              {displayToken.tokenNumber}
            </div>
            {displayToken.customerName && (
              <span style={{ fontSize: '0.85rem', color: '#a5b4fc' }}>
                Issued for: <strong>{displayToken.customerName}</strong>
              </span>
            )}
          </div>

          <div>
            {isWaiting && (
              <Badge variant="waiting">
                {activeMetrics?.isNextInLine ? 'Next in Line' : 'Waiting in Line'}
              </Badge>
            )}
            {isServing && <Badge variant="serving">Now Serving</Badge>}
            {isCompleted && (
              <Badge variant="serving" style={{ background: 'rgba(16, 185, 129, 0.2)', color: '#34d399', border: '1px solid #10b981' }}>
                ✓ Completed
              </Badge>
            )}
            {isSkipped && (
              <Badge variant="waiting" style={{ background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24', border: '1px solid #f59e0b' }}>
                ⚠️ Skipped / Absent
              </Badge>
            )}
            {isCancelled && (
              <Badge variant="prefix" style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#f87171', border: '1px solid #ef4444' }}>
                Cancelled
              </Badge>
            )}
          </div>
        </div>

        {/* Two-Column Metadata */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.5rem' }}>
          <div>
            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Service Counter</span>
            <div style={{ fontWeight: '600', fontSize: '1rem', marginTop: '0.2rem' }}>
              {displayToken.serviceName}
            </div>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Issued at {formattedCreatedAt}
            </span>
          </div>

          <div>
            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              {isWaiting ? 'Queue Position' : 'Status'}
            </span>
            <div
              className="mono"
              style={{
                fontWeight: '700',
                fontSize: '1.2rem',
                color: isServing ? '#34d399' : isWaiting ? '#fbbf24' : isCompleted ? '#34d399' : isSkipped ? '#fbbf24' : '#f87171',
                marginTop: '0.2rem'
              }}
            >
              {isWaiting && `#${activeMetrics?.position || 1} in line`}
              {isServing && 'Now Serving'}
              {isCompleted && 'Completed'}
              {isSkipped && 'Skipped'}
              {isCancelled && 'Cancelled'}
            </div>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {isWaiting && `${activeMetrics?.waitingAhead ?? 0} ${activeMetrics?.waitingAhead === 1 ? 'person' : 'people'} ahead of you`}
              {isServing && 'Please proceed to counter'}
              {isCompleted && `Finished at ${new Date(displayToken.completedAt || Date.now()).toLocaleTimeString()}`}
              {isSkipped && `Marked absent at ${new Date(displayToken.skippedAt || Date.now()).toLocaleTimeString()}`}
              {isCancelled && 'Ticket revoked'}
            </span>
          </div>
        </div>

        {/* Status / Wait Time Banner */}
        {isWaiting && (
          <div 
            style={{ 
              background: 'rgba(99, 102, 241, 0.08)', 
              border: '1px solid rgba(99, 102, 241, 0.25)', 
              borderRadius: 'var(--radius-md)', 
              padding: '1.25rem', 
              textAlign: 'center', 
              marginBottom: '1.5rem' 
            }}
          >
            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#a5b4fc', letterSpacing: '0.05em', fontWeight: '600' }}>
              Estimated Waiting Time
            </span>
            <div className="mono" style={{ fontSize: '2.25rem', fontWeight: '800', color: '#ffffff', margin: '0.35rem 0' }}>
              {activeMetrics?.displayText || '~5 min estimated'}
            </div>
            <p style={{ fontSize: '0.9rem', color: '#c7d2fe', fontWeight: '500' }}>
              {activeMetrics?.statusWording || 'Registered in queue'}
            </p>

            {/* Stage B Estimation Disclosure & Sample Metadata */}
            <div 
              style={{ 
                marginTop: '0.85rem', 
                paddingTop: '0.75rem', 
                borderTop: '1px dashed rgba(99, 102, 241, 0.2)', 
                fontSize: '0.825rem',
                color: 'var(--text-secondary)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                <span 
                  className="mono" 
                  style={{ 
                    color: activeMetrics?.isUsingFallback ? '#fbbf24' : '#34d399', 
                    fontWeight: '700',
                    fontSize: '0.8rem'
                  }}
                >
                  {activeMetrics?.isUsingFallback
                    ? '• Method: Standard Baseline Duration'
                    : `• Method: Adaptive Rolling Average (${activeMetrics?.sampleCount || 0} / 5 completed samples)`}
                </span>
                {!activeMetrics?.isUsingFallback && activeMetrics?.rollingAverageMinutes !== null && (
                  <span style={{ color: '#a5b4fc', fontSize: '0.775rem' }}>
                    (Recent avg: ~{activeMetrics.rollingAverageMinutes} min)
                  </span>
                )}
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0', fontStyle: 'italic' }}>
                {activeMetrics?.isUsingFallback
                  ? `Using standard service duration (${activeMetrics?.baselineDuration || 5} min baseline). Historical data: Not available. Estimated wait before counter call, not a completion guarantee.`
                  : `Based on recent completed transactions. Historical samples: ${activeMetrics?.sampleCount || 0}. Statistical arithmetic mean; actual service times may vary.`}
              </p>
            </div>
          </div>
        )}

        {isServing && (
          <div 
            style={{ 
              background: 'rgba(16, 185, 129, 0.12)', 
              border: '1px solid rgba(16, 185, 129, 0.35)', 
              borderRadius: 'var(--radius-md)', 
              padding: '1.25rem', 
              textAlign: 'center', 
              marginBottom: '1.5rem' 
            }}
          >
            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#34d399', letterSpacing: '0.05em', fontWeight: '700' }}>
              Active Counter Call
            </span>
            <div className="mono" style={{ fontSize: '2rem', fontWeight: '800', color: '#34d399', margin: '0.35rem 0' }}>
              At the Counter
            </div>
            <p style={{ fontSize: '0.925rem', color: '#a7f3d0', fontWeight: '600' }}>
              Now Serving — Please proceed immediately to {displayToken.serviceName}
            </p>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              Called at {new Date(displayToken.calledAt || Date.now()).toLocaleTimeString()}
            </div>
          </div>
        )}

        {isCompleted && (
          <div 
            style={{ 
              background: 'rgba(16, 185, 129, 0.08)', 
              border: '1px solid rgba(16, 185, 129, 0.25)', 
              borderRadius: 'var(--radius-md)', 
              padding: '1.25rem', 
              textAlign: 'center', 
              marginBottom: '1.5rem' 
            }}
          >
            <div style={{ fontSize: '2rem', marginBottom: '0.35rem' }}>✅</div>
            <div className="mono" style={{ fontSize: '1.4rem', fontWeight: '700', color: '#34d399', marginBottom: '0.25rem' }}>
              Service Completed
            </div>
            <p style={{ fontSize: '0.875rem', color: '#a7f3d0' }}>
              Your transaction for {displayToken.serviceName} has successfully concluded.
            </p>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              Active wait estimates have ceased. Thank you for using QueueLess.
            </div>
          </div>
        )}

        {isSkipped && (
          <div 
            style={{ 
              background: 'rgba(245, 158, 11, 0.08)', 
              border: '1px solid rgba(245, 158, 11, 0.25)', 
              borderRadius: 'var(--radius-md)', 
              padding: '1.25rem', 
              textAlign: 'center', 
              marginBottom: '1.5rem' 
            }}
          >
            <div style={{ fontSize: '2rem', marginBottom: '0.35rem' }}>⚠️</div>
            <div className="mono" style={{ fontSize: '1.4rem', fontWeight: '700', color: '#fbbf24', marginBottom: '0.25rem' }}>
              Customer Skipped / Absent
            </div>
            <p style={{ fontSize: '0.875rem', color: '#fde68a' }}>
              Your number was called at the counter, but you were marked absent.
            </p>
            <div style={{ fontSize: '0.8rem', color: '#d1d5db', marginTop: '0.5rem' }}>
              If you have arrived, please speak to staff at the counter to request a re-queue to the tail of the line.
            </div>
          </div>
        )}

        {isCancelled && (
          <div 
            style={{ 
              background: 'rgba(239, 68, 68, 0.08)', 
              border: '1px solid rgba(239, 68, 68, 0.25)', 
              borderRadius: 'var(--radius-md)', 
              padding: '1.25rem', 
              textAlign: 'center', 
              marginBottom: '1.5rem' 
            }}
          >
            <div style={{ fontSize: '2rem', marginBottom: '0.35rem' }}>🛑</div>
            <div className="mono" style={{ fontSize: '1.4rem', fontWeight: '700', color: '#f87171', marginBottom: '0.25rem' }}>
              Ticket Cancelled
            </div>
            <p style={{ fontSize: '0.875rem', color: '#fca5a5' }}>
              This ticket was cancelled and will not be called to the counter.
            </p>
          </div>
        )}

        {/* Ticket Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {isWaiting && (
            confirmCancel ? (
              <div style={{ background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius-md)', padding: '1rem', textAlign: 'center' }}>
                <p style={{ fontSize: '0.85rem', color: '#fca5a5', marginBottom: '0.75rem' }}>
                  Are you sure you want to cancel ticket <strong>{displayToken.tokenNumber}</strong>? You will lose your spot in line.
                </p>
                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                  <button 
                    type="button" 
                    className="btn btn-secondary" 
                    style={{ fontSize: '0.85rem', padding: '0.4rem 1rem' }}
                    onClick={() => setConfirmCancel(false)}
                  >
                    Keep Ticket
                  </button>
                  <button 
                    type="button" 
                    className="btn" 
                    style={{ background: '#ef4444', color: '#ffffff', fontSize: '0.85rem', padding: '0.4rem 1rem' }}
                    onClick={handleCancelClick}
                  >
                    Confirm Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button 
                type="button" 
                className="btn btn-outline" 
                style={{ color: '#f87171', borderColor: 'rgba(239, 68, 68, 0.35)' }}
                onClick={handleCancelClick}
              >
                Cancel This Ticket
              </button>
            )
          )}

          {(isCompleted || isSkipped || isCancelled) ? (
            <button 
              type="button" 
              className="btn btn-primary" 
              onClick={handleDismissAndHome}
            >
              Done / Join Another Queue
            </button>
          ) : (
            <button 
              type="button" 
              className="btn btn-secondary" 
              onClick={onNavigateHome}
            >
              ← View All Service Desks
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
