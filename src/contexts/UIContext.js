import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import ToastViewport from '../components/ui/ToastViewport';
import ConfirmDialog from '../components/ui/ConfirmDialog';

const ToastContext = createContext(null);
const ConfirmContext = createContext(null);

const generateId = () => `toast-${Math.random().toString(36).slice(2, 11)}`;

export const UIProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);

  const pushToast = useCallback((title, options = {}) => {
    if (!title) return null;
    const toast = {
      id: generateId(),
      title,
      description: options.description || '',
      tone: options.tone || 'info',
      duration: options.duration ?? 3500,
    };
    setToasts(prev => [...prev, toast]);
    return toast.id;
  }, []);

  const dismissToast = useCallback((toastId) => {
    setToasts(prev => prev.filter(toast => toast.id !== toastId));
  }, []);

  const confirm = useCallback((options = {}) => new Promise((resolve) => {
    setConfirmState({
      ...options,
      resolve,
    });
  }), []);

  const handleConfirm = useCallback((result) => {
    if (confirmState?.resolve) {
      confirmState.resolve(result);
    }
    setConfirmState(null);
  }, [confirmState]);

  const toastValue = useMemo(() => ({ pushToast, dismissToast }), [pushToast, dismissToast]);

  return (
    <ToastContext.Provider value={toastValue}>
      <ConfirmContext.Provider value={confirm}>
        {children}
        <ToastViewport toasts={toasts} onDismiss={dismissToast} />
        {confirmState && (
          <ConfirmDialog
            title={confirmState.title}
            description={confirmState.description}
            confirmLabel={confirmState.confirmLabel}
            cancelLabel={confirmState.cancelLabel}
            onConfirm={() => handleConfirm(true)}
            onCancel={() => handleConfirm(false)}
          />
        )}
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast должен вызываться внутри UIProvider');
  }
  return context;
};

export const useConfirm = () => {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm должен вызываться внутри UIProvider');
  }
  return context;
};

