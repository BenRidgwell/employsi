import { useEffect } from "react";
import { useAppStore } from "../state/store";

/**
 * Transient bottom-centre notification; auto-dismisses.
 *
 * MESSAGE AND DISMISS ONLY. It used to carry a hardcoded "Sign in" action
 * button, from when its only messages were the signed-out follow prompts. Those
 * are retired (the app is signed-in-only — see getAppAccess), and the button was
 * wrong for the messages that remain anyway: every toast now set is about
 * geolocation ("This browser can't share a location.", "Location permission was
 * declined."), and each of those offered a Sign in button that had nothing to do
 * with what it was telling you.
 */
export function Toast() {
  const toast = useAppStore((s) => s.toast);
  const dismiss = useAppStore((s) => s.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(dismiss, 5200);
    return () => clearTimeout(t);
  }, [toast, dismiss]);

  if (!toast) return null;
  return (
    <div className="toast" role="status">
      <span className="toastmsg">{toast}</span>
      <button className="toastx" aria-label="Dismiss" onClick={dismiss}>
        <svg
          viewBox="0 0 24 24"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.4}
          strokeLinecap="round"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
