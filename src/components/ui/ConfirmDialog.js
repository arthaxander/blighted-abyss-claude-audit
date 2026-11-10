import React from 'react';
import { createPortal } from 'react-dom';

const ConfirmDialog = ({
  title = 'Подтверждение',
  description,
  confirmLabel = 'Да',
  cancelLabel = 'Отмена',
  onConfirm,
  onCancel,
}) => {
  const dialog = (
  <div style={styles.overlay} role="presentation" onClick={event => event.stopPropagation()}>
    <div style={styles.modal} role="dialog" aria-modal="true" aria-label={title}>
      <h3>{title}</h3>
      {description && <p style={styles.description}>{description}</p>}
      <div style={styles.actions}>
        <button type="button" data-sfx="cancel" style={styles.cancel} onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="button" data-sfx="confirm" style={styles.confirm} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
  );
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
};

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 'var(--overlay-layer-confirmation, 4600)',
    padding: 16,
  },
  modal: {
    background: '#1b1b1b',
    color: '#fff',
    padding: '24px 28px',
    borderRadius: 10,
    width: '100%',
    maxWidth: 420,
    boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
  },
  description: {
    marginTop: 8,
    marginBottom: 18,
    lineHeight: 1.4,
    whiteSpace: 'pre-line',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 12,
  },
  cancel: {
    padding: '10px 18px',
    borderRadius: 6,
    border: '1px solid #555',
    background: 'transparent',
    color: '#fff',
    cursor: 'pointer',
  },
  confirm: {
    padding: '10px 18px',
    borderRadius: 6,
    border: 'none',
    background: '#2d8cf0',
    color: '#fff',
    cursor: 'pointer',
  },
};

export default ConfirmDialog;
