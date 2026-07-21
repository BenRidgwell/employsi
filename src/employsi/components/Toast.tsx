import { useEffect } from 'react';
import { useAppStore } from '../state/store';

// Transient bottom-centre notification. Currently used to tell a signed-out
// user they need an account before they can follow a company; auto-dismisses.
export function Toast() {
  const toast = useAppStore((s) => s.toast);
  const dismiss = useAppStore((s) => s.dismissToast);
  const openAuth = useAppStore((s) => s.openAuth);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(dismiss, 5200);
    return () => clearTimeout(t);
  }, [toast, dismiss]);

  if (!toast) return null;
  return (
    <div className="toast" role="status">
      <span className="toastmsg">{toast}</span>
      <button className="toastact" onClick={openAuth}>Sign in</button>
      <button className="toastx" aria-label="Dismiss" onClick={dismiss}>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
