import React, { useEffect } from 'react';

const tones = {
  info: '#2d8cf0',
  success: '#2ba84a',
  warning: '#f5a524',
  danger: '#e54b4b',
};

const ToastViewport = ({ toasts = [], onDismiss }) => {
  useEffect(() => {
    const timers = toasts.map(toast => {
      if (!toast.duration) return null;
      return setTimeout(() => onDismiss?.(toast.id), toast.duration);
    });
    return () => timers.forEach(timer => timer && clearTimeout(timer));
  }, [toasts, onDismiss]);

  if (!toasts.length) return null;

  return (
    <div style={styles.viewport}>
      {toasts.map(toast => (
        <div key={toast.id} style={{ ...styles.toast, borderLeftColor: tones[toast.tone] || tones.info }}>
          <div>
            <strong>{toast.title}</strong>
            {toast.description && <p style={styles.description}>{toast.description}</p>}
          </div>
          <button style={styles.dismiss} onClick={() => onDismiss?.(toast.id)}>×</button>
        </div>
      ))}
    </div>
  );
};

const styles = {
  viewport: {
    position: 'fixed',
    right: 16,
    top: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    zIndex: 2000,
    maxWidth: 'calc(100vw - 32px)',
  },
  toast: {
    background: '#1f1f1f',
    color: '#fff',
    padding: '12px 40px 12px 16px',
    borderRadius: 8,
    borderLeft: '4px solid #2d8cf0',
    boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
    minWidth: 220,
    position: 'relative',
  },
  dismiss: {
    position: 'absolute',
    right: 8,
    top: 8,
    background: 'transparent',
    color: '#fff',
    border: 'none',
    fontSize: 16,
    cursor: 'pointer',
  },
  description: {
    margin: '6px 0 0',
    fontSize: 14,
    opacity: 0.9,
  },
};

export default ToastViewport;

