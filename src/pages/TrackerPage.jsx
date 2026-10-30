import React, { useState } from 'react';
import Badge from '../components/Badge.jsx';

/**
 * TrackerPage: Customer Live Digital Ticket & Queue Position Tracker
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
            You do not currently hold an active queue ticket in this browser session. Select a service desk to join the line.
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
    minute: '2-digit'
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
            ? 'Your ticket is now called. Please proceed directly to the counter.'
            : isCompleted
            ? 'Your service session has concluded.'
            : isSkipped
            ? 'Your ticket was skipped. Please contact counter staff.'
            : isCancelled
            ? 'This ticket has been cancelled.'
            : 'Track your queue position and live estimated wait time in real time.'}
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
              Your Ticket Number
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
                {activeMetrics?.isNextInLine ? 'Next in Line' : 'In Queue'}
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
                Skipped
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
              {isCompleted && `Finished at ${new Date(displayToken.completedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
              {isSkipped && 'Absent when called'}
              {isCancelled && 'Revoked by user'}
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

            <div 
              style={{ 
                marginTop: '0.85rem', 
                paddingTop: '0.75rem', 
                borderTop: '1px dashed rgba(99, 102, 241, 0.2)', 
                fontSize: '0.8rem',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem'
              }}
            >
              <span>⏱ Live wait estimation calibrated by counter pace</span>
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
              Your Turn
            </span>
            <div className="mono" style={{ fontSize: '2rem', fontWeight: '800', color: '#34d399', margin: '0.35rem 0' }}>
              Now Serving
            </div>
            <p style={{ fontSize: '0.925rem', color: '#a7f3d0', fontWeight: '600' }}>
              Please proceed immediately to {displayToken.serviceName}
            </p>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              Called at {new Date(displayToken.calledAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
              Your transaction for {displayToken.serviceName} has concluded. Thank you for using QueueLess.
            </p>
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
              Customer Skipped
            </div>
            <p style={{ fontSize: '0.875rem', color: '#fde68a' }}>
              Your ticket was called, but you were marked absent.
            </p>
            <div style={{ fontSize: '0.8rem', color: '#d1d5db', marginTop: '0.5rem' }}>
              If you have arrived, please speak to staff at the counter to be re-queued.
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
              This ticket has been cancelled.
            </p>
          </div>
        )}

        {/* Ticket Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {isWaiting && (
            confirmCancel ? (
              <div style={{ background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius-md)', padding: '1rem', textAlign: 'center' }}>
                <p style={{ fontSize: '0.85rem', color: '#fca5a5', marginBottom: '0.75rem' }}>
                  Cancel ticket <strong>{displayToken.tokenNumber}</strong>? You will lose your current spot in line.
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
                Cancel Ticket
              </button>
            )
          )}

          {(isCompleted || isSkipped || isCancelled) ? (
            <button 
              type="button" 
              className="btn btn-primary" 
              onClick={handleDismissAndHome}
            >
              Done / Return to Services
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
