import type { ReactNode } from 'react';
import { useAppStore } from '../state/store';

// The mobile bottom-bar "More" sheet: a single place for the secondary actions
// that live in scattered docks on desktop (daily brief, account, employer /
// employee tools, feedback, help, settings). Each row drives the same store
// flag its desktop control does, so the panels themselves are reused.

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const Brief = () => (<svg {...svg}><path d="M4 5.6A1.1 1.1 0 0 1 5.1 4.5h7.3a1.1 1.1 0 0 1 1.1 1.1V15H5.1A1.1 1.1 0 0 1 4 13.9V5.6Z" /><path d="M6.4 7.6h4.8M6.4 10h4.8M6.4 12.4h3" /><path d="M13.6 15.4h4.6v1.6a2 2 0 0 1-2 2h-.6a2 2 0 0 1-2-2v-1.6Z" /></svg>);
const Person = () => (<svg {...svg}><circle cx="12" cy="8" r="3.4" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></svg>);
const Feedback = () => (<svg {...svg}><path d="M4 5.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 3.2V16.5H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" /><path d="M8 9.5h8M8 12.5h5" /></svg>);
const Help = () => (<svg {...svg}><circle cx="12" cy="12" r="9" /><path d="M9.2 9.3a2.8 2.8 0 0 1 5.4 1c0 1.9-2.6 2.2-2.6 3.9" /><circle cx="12" cy="17.4" r="0.6" fill="currentColor" stroke="none" /></svg>);
const Cog = () => (<svg {...svg}><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M4.2 7.5l2.2 1.3M17.6 15.2l2.2 1.3M4.2 16.5l2.2-1.3M17.6 8.8l2.2-1.3" /></svg>);

function Row({ icon, label, sub, onClick }: { icon: ReactNode; label: string; sub?: string; onClick: () => void }) {
  return (
    <button className="mmrow" onClick={onClick}>
      <span className="mmrowic">{icon}</span>
      <span className="mmrowtext">
        <span className="mmrowlbl">{label}</span>
        {sub && <span className="mmrowsub">{sub}</span>}
      </span>
      <span className="mmrowchev">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
      </span>
    </button>
  );
}

export function MobileMenu() {
  const open = useAppStore((s) => s.mobileMenuOpen);
  const close = useAppStore((s) => s.closeMobileMenu);
  const account = useAppStore((s) => s.account);
  const openAuth = useAppStore((s) => s.openAuth);
  const toggleBrief = useAppStore((s) => s.toggleBrief);
  const toggleFeedback = useAppStore((s) => s.toggleFeedback);
  const toggleHelpTour = useAppStore((s) => s.toggleHelpTour);
  const toggleSettings = useAppStore((s) => s.toggleSettings);

  const settings = () => { close(); toggleSettings(); };

  return (
    <>
      {open && <div className="mmscrim" onClick={close} />}
      <div className={`mobilemenu ${open ? 'open' : ''}`} role="dialog" aria-label="More">
        <div className="mmgrip" />
        <div className="mmhd">
          <span>More</span>
          <button className="mmx" onClick={close} aria-label="Close">✕</button>
        </div>

        <div className="mmsec">Discover</div>
        <Row icon={<Brief />} label="Daily brief" sub="Today's live market news" onClick={toggleBrief} />

        <div className="mmsec">Account</div>
        <Row icon={<Person />} label={account ? account.name : 'Sign in or create account'} sub={account ? account.email : 'Save companies you follow'} onClick={openAuth} />

        <div className="mmsec">Support</div>
        <Row icon={<Feedback />} label="Feedback" sub="Suggest & vote on ideas" onClick={toggleFeedback} />
        <Row icon={<Help />} label="Help & tips" onClick={toggleHelpTour} />
        <Row icon={<Cog />} label="Settings" onClick={settings} />
      </div>
    </>
  );
}
