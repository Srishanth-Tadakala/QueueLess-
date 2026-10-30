import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar.jsx';
import HomePage from './pages/HomePage.jsx';
import TrackerPage from './pages/TrackerPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import { useQueue } from './hooks/useQueue.js';

/**
 * QueueLess Application Shell
 */
export default function App() {
  const [activeView, setActiveView] = useState(() => {
    const hash = window.location.hash.replace('#/', '');
    if (['home', 'tracker', 'admin'].includes(hash)) {
      return hash;
    }
    return 'home';
  });

  const queue = useQueue();

  // Synchronize browser URL hash with active view
  useEffect(() => {
    window.location.hash = `#/${activeView}`;
  }, [activeView]);

  // Handle browser back/forward buttons
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#/', '');
      if (['home', 'tracker', 'admin'].includes(hash)) {
        setActiveView(hash);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleIssueTokenSuccess = (token) => {
    setActiveView('tracker');
  };

  return (
    <div className="app-shell">
      {/* Top Navigation */}
      <Navbar activeView={activeView} onViewChange={setActiveView} />

      {/* Global Storage Notices or Error Banners */}
      {queue.storageNotice && (
        <aside 
          className="notification-banner warning" 
          role="status" 
          aria-live="polite"
          style={{
            background: 'rgba(245, 158, 11, 0.12)',
            borderBottom: '1px solid rgba(245, 158, 11, 0.3)',
            padding: '0.65rem 1.5rem',
            fontSize: '0.875rem',
            color: '#fbbf24',
            textAlign: 'center'
          }}
        >
          <span>⚠️ {queue.storageNotice}</span>
        </aside>
      )}

      {queue.error && (
        <aside 
          className="notification-banner error" 
          role="alert" 
          aria-live="assertive"
          style={{
            background: 'rgba(239, 68, 68, 0.15)',
            borderBottom: '1px solid rgba(239, 68, 68, 0.35)',
            padding: '0.65rem 1.5rem',
            fontSize: '0.875rem',
            color: '#f87171',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem'
          }}
        >
          <span>🛑 {queue.error}</span>
          <button
            type="button"
            onClick={queue.clearError}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#f87171',
              cursor: 'pointer',
              fontWeight: '700',
              textDecoration: 'underline'
            }}
          >
            Dismiss
          </button>
        </aside>
      )}

      {/* Main View Router */}
      <main className="main-content">
        {activeView === 'home' && (
          <HomePage 
            queueState={queue.queueState}
            activeToken={queue.activeToken}
            onIssueToken={queue.issueToken}
            onIssueSuccess={handleIssueTokenSuccess}
            onNavigateTracker={() => setActiveView('tracker')}
          />
        )}
        {activeView === 'tracker' && (
          <TrackerPage 
            activeToken={queue.activeToken}
            trackedToken={queue.trackedToken}
            activeMetrics={queue.activeMetrics}
            onCancelToken={queue.cancelToken}
            onDismissSession={queue.dismissSessionToken}
            onNavigateHome={() => setActiveView('home')}
          />
        )}
        {activeView === 'admin' && (
          <AdminPage 
            queueState={queue.queueState}
            serviceAnalytics={queue.serviceAnalytics}
            onCallNext={queue.callNext}
            onCompleteServing={queue.completeServing}
            onSkipServing={queue.skipServing}
            onRequeue={queue.requeue}
            onTogglePause={queue.togglePause}
            onResetService={queue.resetService}
            onResetAll={queue.resetAll}
          />
        )}
      </main>

      {/* Application Footer */}
      <footer className="footer">
        <div className="footer-container">
          <div>
            <strong style={{ color: 'var(--text-primary)' }}>QueueLess</strong> — Smart Real-Time Queue Management
            <div style={{ fontSize: '0.8rem', marginTop: '0.2rem', color: 'var(--text-muted)' }}>
              Live Virtual Queuing & Adaptive Wait-Time Estimation
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              © {new Date().getFullYear()} QueueLess • Real-Time Synchronization
            </span>
            <div style={{ fontSize: '0.775rem', color: 'var(--text-muted)' }}>All Systems Operational</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
