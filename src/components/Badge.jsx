import React from 'react';

/**
 * Reusable Badge component for service codes and status tags.
 */
export default function Badge({ children, variant = 'info', className = '' }) {
  const variantClass = {
    prefix: 'badge-prefix',
    waiting: 'badge-waiting',
    serving: 'badge-serving',
    completed: 'badge-completed',
    info: 'badge-info'
  }[variant] || 'badge-info';

  return (
    <span className={`badge ${variantClass} ${className}`}>
      {children}
    </span>
  );
}
