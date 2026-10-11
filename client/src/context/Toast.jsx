import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Check, X, Info, AlertTriangle } from 'lucide-react';

const ToastContext = createContext(null);
const ConfirmContext = createContext(null);

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const counter = useRef(0);

  const push = useCallback((type, message) => {
    const id = ++counter.current;
    setToasts(list => [...list.slice(-3), { id, type, message }]);
    window.setTimeout(() => setToasts(list => list.filter(t => t.id !== id)), type === 'error' ? 6500 : 4000);
  }, []);
  const toast = useMemo(() => ({ success: m => push('success', m), error: m => push('error', m), info: m => push('info', m) }), [push]);
  const confirm = useCallback(options => new Promise(resolve => setDialog({ ...options, resolve })), []);
  const close = result => { dialog?.resolve(result); setDialog(null); };

  return (
    <ToastContext.Provider value={toast}>
      <ConfirmContext.Provider value={confirm}>
        {children}
        <div className="toast-region" aria-live="polite">
          {toasts.map(t => (
            <div key={t.id} className={`toast toast-${t.type}`} role={t.type === 'error' ? 'alert' : 'status'}>
              <span className="toast-icon">{t.type === 'error' ? <AlertTriangle size={16} /> : t.type === 'info' ? <Info size={16} /> : <Check size={16} />}</span>
              <span className="toast-text">{t.message}</span>
              <button className="toast-close" aria-label="Dismiss" onClick={() => setToasts(list => list.filter(x => x.id !== t.id))}><X size={14} /></button>
            </div>
          ))}
        </div>
        {dialog && (
          <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(false); }}>
            <div className="modal modal-sm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
              <h2 id="confirm-title" className="modal-title">{dialog.title}</h2>
              {dialog.message && <p className="modal-text">{dialog.message}</p>}
              <div className="modal-actions">
                <button className="btn btn-secondary" autoFocus onClick={() => close(false)}>{dialog.cancelLabel || 'Cancel'}</button>
                <button className={`btn ${dialog.tone === 'danger' ? 'btn-danger-solid' : 'btn-primary'}`} onClick={() => close(true)}>{dialog.confirmLabel || 'Confirm'}</button>
              </div>
            </div>
          </div>
        )}
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);
export const useConfirm = () => useContext(ConfirmContext);
