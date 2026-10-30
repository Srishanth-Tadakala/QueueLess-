import React from 'react';
import Badge from './Badge.jsx';

/**
 * Service Catalogue Card
 * Displays service information, desk number, queue depth, and estimated service time.
 */
export default function ServiceCard({ service, onSelect, waitingCount = 0 }) {
  return (
    <article className="service-card" aria-labelledby={`service-${service.id}`}>
      <div>
        <div className="service-header">
          <Badge variant="prefix">{service.prefix}</Badge>
          <span className="mono" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {service.counterNumber}
          </span>
        </div>

        <h3 id={`service-${service.id}`} className="service-title">
          {service.name}
        </h3>

        <div className="service-meta">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: waitingCount === 0 ? '#10b981' : '#f59e0b' }} />
            {waitingCount === 0 ? 'Desk Ready' : `${waitingCount} waiting in line`}
          </span>
        </div>

        <p className="service-description">
          {service.description}
        </p>
      </div>

      <div className="service-footer">
        <div className="service-duration">
          <span className="service-duration-label">Est. Service Time</span>
          <span className="service-duration-val mono">
            ~{service.baselineDurationMinutes} min
          </span>
        </div>

        <button 
          type="button"
          className="btn btn-primary"
          onClick={() => onSelect && onSelect(service)}
        >
          Select Desk
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/>
            <polyline points="12 5 19 12 12 19"/>
          </svg>
        </button>
      </div>
    </article>
  );
}
