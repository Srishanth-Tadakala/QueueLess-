import React from 'react';

/**
 * Top Navigation Bar with View Switcher and Academic Evaluation Context
 */
export default function Navbar({ activeView, onViewChange }) {
  return (
    <header className="navbar">
      <div className="navbar-container">
        {/* Brand */}
        <div 
          className="navbar-brand" 
          onClick={() => onViewChange('home')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && onViewChange('home')}
          aria-label="QueueLess Home"
        >
          <div className="navbar-logo">Q</div>
          <div className="navbar-title">
            Queue<span>Less</span>
          </div>
        </div>

        {/* Navigation Views */}
        <nav className="navbar-nav" aria-label="Main Navigation">
          <button
            type="button"
            className={`nav-link ${activeView === 'home' ? 'active' : ''}`}
            onClick={() => onViewChange('home')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
            Services
          </button>

          <button
            type="button"
            className={`nav-link ${activeView === 'tracker' ? 'active' : ''}`}
            onClick={() => onViewChange('tracker')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2"/>
              <path d="M7 7h.01M17 7h.01M7 17h.01M17 17h.01"/>
            </svg>
            Live Tracker
          </button>

          <button
            type="button"
            className={`nav-link ${activeView === 'admin' ? 'active' : ''}`}
            onClick={() => onViewChange('admin')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="20" height="14" x="2" y="5" rx="2"/>
              <line x1="2" x2="22" y1="10" y2="10"/>
            </svg>
            Admin Panel
          </button>
        </nav>

        {/* Academic Context Badge */}
        <div className="academic-badge" title="End Semester Examination Prototype">
          <span>CSE (AI/ML) · Sem 3</span>
        </div>
      </div>
    </header>
  );
}
