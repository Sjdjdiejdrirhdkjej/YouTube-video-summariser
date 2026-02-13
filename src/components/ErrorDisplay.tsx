import React from 'react';
import { useError, AppError } from '../context/ErrorContext';

const ErrorToast = ({ error, onClose }: { error: AppError; onClose: () => void }) => {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-error)',
        borderLeft: '4px solid var(--color-error)',
        borderRadius: 'var(--radius-md)',
        padding: '12px 16px',
        marginBottom: '12px',
        boxShadow: 'var(--shadow-lg)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '12px',
        minWidth: '300px',
        maxWidth: '400px',
        animation: 'fadeIn 0.3s ease',
        pointerEvents: 'auto',
      }}
    >
      <div style={{ flex: 1 }}>
        <h4
          style={{
            margin: '0 0 4px',
            fontSize: '0.875rem',
            fontWeight: 600,
            color: 'var(--color-error)',
          }}
        >
          Error
        </h4>
        <p
          style={{
            margin: 0,
            fontSize: '0.8125rem',
            color: 'var(--color-text-main)',
            wordBreak: 'break-word',
          }}
        >
          {error.message}
        </p>
        {error.stack && (
          <details style={{ marginTop: '8px' }}>
            <summary
              style={{
                cursor: 'pointer',
                fontSize: '0.75rem',
                color: 'var(--color-text-secondary)',
              }}
            >
              Stack Trace
            </summary>
            <pre
              style={{
                margin: '8px 0 0',
                padding: '8px',
                backgroundColor: 'var(--color-bg-hover)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.7rem',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                maxHeight: '150px',
              }}
            >
              {error.stack}
            </pre>
          </details>
        )}
      </div>
      <button
        onClick={onClose}
        style={{
          background: 'none',
          border: 'none',
          padding: '4px',
          cursor: 'pointer',
          color: 'var(--color-text-muted)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-label="Close error"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
};

export const ErrorDisplay = () => {
  const { errors, removeError } = useError();

  if (errors.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        pointerEvents: 'none', // Allow clicking through the container
      }}
    >
      {errors.map((error) => (
        <ErrorToast key={error.id} error={error} onClose={() => removeError(error.id)} />
      ))}
    </div>
  );
};
