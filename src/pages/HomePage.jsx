import React, { useState } from 'react';
import { APPROVED_SERVICES, formatTokenNumber } from '../utils/services.js';
import ServiceCard from '../components/ServiceCard.jsx';
import Badge from '../components/Badge.jsx';

/**
 * HomePage: Service Catalogue & Customer Token Issuance Flow
 */
export default function HomePage({
  queueState,
  activeToken,
  onIssueToken,
  onIssueSuccess,
  onNavigateTracker
}) {
  const [selectedService, setSelectedService] = useState(null);
  const [customerName, setCustomerName] = useState('');
  const [issuanceError, setIssuanceError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCardClick = (service) => {
    setIssuanceError(null);
    if (activeToken) {
      setIssuanceError(
        `Active Ticket Held: You already have token ${activeToken.tokenNumber} in ${activeToken.status} status. You cannot issue another token until this service is completed or cancelled.`
      );
      return;
    }
    setSelectedService(service);
  };

  const handleConfirmIssuance = (e) => {
    e.preventDefault();
    if (!selectedService) return;

    setIsSubmitting(true);
    setIssuanceError(null);

    const result = onIssueToken(selectedService.id, customerName);
    setIsSubmitting(false);

    if (result.success) {
      setSelectedService(null);
      setCustomerName('');
      if (onIssueSuccess) {
        onIssueSuccess(result.token);
      }
    } else {
      setIssuanceError(result.error);
    }
  };

  return (
    <div className="home-page">
      {/* Active Token Notification Banner */}
      {activeToken && (
        <aside 
          className="glass-card" 
          style={{
            borderColor: 'rgba(99, 102, 241, 0.4)',
            background: 'rgba(99, 102, 241, 0.1)',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem'
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <Badge variant="waiting">{activeToken.status}</Badge>
              <strong style={{ color: '#ffffff' }}>Active Queue Ticket: {activeToken.tokenNumber}</strong>
            </div>
            <p style={{ fontSize: '0.875rem', color: '#c7d2fe', margin: 0 }}>
              You are currently registered for <strong>{activeToken.serviceName}</strong>. You cannot request another token in this session.
            </p>
          </div>
          <button 
            type="button" 
            className="btn btn-primary"
            onClick={onNavigateTracker}
          >
            Open Ticket Tracker →
          </button>
        </aside>
      )}

      {/* Global Issuance Error Notice */}
      {issuanceError && !selectedService && (
        <div 
          className="glass-card" 
          style={{
            borderColor: 'rgba(239, 68, 68, 0.4)',
            background: 'rgba(239, 68, 68, 0.1)',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem'
          }}
        >
          <span style={{ color: '#fca5a5', fontSize: '0.9rem' }}>⚠️ {issuanceError}</span>
          <button 
            type="button" 
            className="btn btn-outline" 
            style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
            onClick={() => setIssuanceError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Hero Section */}
      <section className="hero-section">
        <div className="hero-pill">
          <span>⚡ Phase 3.2: Customer Token Issuance</span>
        </div>
        <h1 className="hero-title">
          Skip Physical Lines with <span>QueueLess</span>
        </h1>
        <p className="hero-subtitle">
          Select an academic service desk, receive a virtual sequential token, and monitor your exact queue position and estimated wait time in real-time.
        </p>
      </section>

      {/* Service Catalogue Grid */}
      <section aria-labelledby="services-heading">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <div>
            <h2 id="services-heading">Available Service Desks</h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              Choose a counter to view queue progress and request a digital ticket.
            </p>
          </div>
          <span className="mono" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', background: 'var(--bg-tertiary)', padding: '0.35rem 0.75rem', borderRadius: 'var(--radius-sm)' }}>
            3 Counters Active
          </span>
        </div>

        <div className="service-grid">
          {APPROVED_SERVICES.map((service) => {
            const waitingCount = queueState?.tokens
              ? queueState.tokens.filter((t) => t.serviceId === service.id && t.status === 'WAITING').length
              : 0;

            return (
              <ServiceCard 
                key={service.id} 
                service={service} 
                waitingCount={waitingCount}
                onSelect={handleCardClick}
              />
            );
          })}
        </div>
      </section>

      {/* Token Request Modal / Dialog */}
      {selectedService && (
        <div 
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-request-token-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem'
          }}
          onClick={() => setSelectedService(null)}
        >
          <div 
            className="glass-card"
            style={{
              maxWidth: '480px',
              width: '100%',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-medium)',
              boxShadow: 'var(--shadow-lg)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
              <div>
                <Badge variant="prefix">{selectedService.prefix}</Badge>
                <h3 id="modal-request-token-title" style={{ fontSize: '1.35rem', marginTop: '0.35rem' }}>
                  Request Queue Token
                </h3>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  {selectedService.name} • {selectedService.counterNumber}
                </span>
              </div>
              <button 
                type="button"
                onClick={() => setSelectedService(null)}
                aria-label="Close modal dialog"
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '1.25rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {issuanceError && (
              <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius-sm)', padding: '0.75rem', marginBottom: '1rem', color: '#fca5a5', fontSize: '0.85rem' }}>
                🛑 {issuanceError}
              </div>
            )}

            <form onSubmit={handleConfirmIssuance}>
              <div style={{ background: 'var(--bg-glass)', borderRadius: 'var(--radius-md)', padding: '1rem', border: '1px solid var(--border-subtle)', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Expected Token Sequence:</span>
                  <span className="mono" style={{ color: 'var(--primary)', fontWeight: '700' }}>
                    {formatTokenNumber(
                      selectedService.prefix,
                      (queueState?.sequenceCounters?.[selectedService.id] || 0) + 1
                    )}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Baseline Wait Estimate:</span>
                  <span className="mono" style={{ color: 'var(--accent-cyan)' }}>
                    {selectedService.baselineDurationMinutes} minutes
                  </span>
                </div>
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <label 
                  htmlFor="customer-name-input"
                  style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.35rem', color: 'var(--text-secondary)' }}
                >
                  Your Name or Student ID (Optional)
                </label>
                <input
                  id="customer-name-input"
                  type="text"
                  placeholder="e.g. Alex M. or 22CS045"
                  maxLength={80}
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.85rem',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-medium)',
                    borderRadius: 'var(--radius-md)',
                    color: '#ffffff',
                    fontSize: '0.95rem'
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  style={{ flex: 1 }}
                  onClick={() => setSelectedService(null)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary" 
                  style={{ flex: 1 }}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Issuing...' : 'Confirm & Get Token'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Workflow Explainer */}
      <section className="workflow-section">
        <h2>How QueueLess Works</h2>
        <p style={{ fontSize: '0.925rem', color: 'var(--text-secondary)' }}>
          A clean, four-step digital workflow replacing physical line standing.
        </p>

        <div className="workflow-grid">
          <div className="workflow-card">
            <div className="workflow-num">01 / SELECT</div>
            <h4>Choose Service</h4>
            <p>Pick your counter based on required transaction: Admissions, Finance, or Records.</p>
          </div>

          <div className="workflow-card">
            <div className="workflow-num">02 / TOKEN</div>
            <h4>Get Digital Token</h4>
            <p>Receive a sequential ticket starting at 001 without requiring account registration.</p>
          </div>

          <div className="workflow-card">
            <div className="workflow-num">03 / TRACK</div>
            <h4>Monitor Wait Time</h4>
            <p>Follow your position and adaptive countdown from your phone anywhere on campus.</p>
          </div>

          <div className="workflow-card">
            <div className="workflow-num">04 / SERVE</div>
            <h4>Proceed to Counter</h4>
            <p>Approach the desk immediately when your status transitions to Now Serving.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
