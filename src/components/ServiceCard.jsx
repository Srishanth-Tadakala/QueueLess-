import React from 'react';
import Badge from './Badge.jsx';
import { formatTokenNumber } from '../utils/services.js';

/**
 * Service Catalogue Card
 * Displays approved service metadata, prefix, baseline duration, and counter number.
 */
export default function ServiceCard({ service, onSelect, waitingCount = 0 }) {
  const sampleToken = formatTokenNumber(service.prefix, 1);

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
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
            {waitingCount === 0 ? 'Queue Ready' : `${waitingCount} waiting`}
          </span>
          <span>•</span>
          <span className="mono" style={{ fontSize: '0.8rem', color: 'var(--primary)' }}>
            Next: {sampleToken}
          </span>
        </div>

        <p className="service-description">
          {service.description}
        </p>
      </div>

      <div className="service-footer">
        <div className="service-duration">
          <span className="service-duration-label">Baseline Duration</span>
          <span className="service-duration-val mono">
            {service.baselineDurationMinutes} min
          </span>
        </div>

        <button 
          type="button"
          className="btn btn-primary"
          onClick={() => onSelect && onSelect(service)}
        >
          Select Service
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/>
            <polyline points="12 5 19 12 12 19"/>
          </svg>
        </button>
      </div>
    </article>
  );
}
