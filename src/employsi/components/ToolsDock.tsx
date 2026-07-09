import { useState, type ReactNode } from 'react';
import { useAppStore } from '../state/store';

interface ToolAction {
  id: string;
  label: string;
  icon: ReactNode;
}

const svgProps = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const BuildingIcon = () => (
  <svg {...svgProps}><path d="M4 21V6.2l6.5-2.7v17.5M10.5 21V9.4L20 12v9M3.5 21h17M7 8.2v.01M7 11.4v.01M7 14.6v.01M14 13.4v.01M16.7 13.4v.01M14 16.6v.01M16.7 16.6v.01" /></svg>
);
const PersonIcon = () => (
  <svg {...svgProps}><circle cx="12" cy="8" r="3.4" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></svg>
);
const CloseIcon = () => (
  <svg {...svgProps}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
const HealthIcon = () => (
  <svg {...svgProps}><path d="M3 12h3.5l2-6 4 12 2-6H21" /></svg>
);
const MarketIcon = () => (
  <svg {...svgProps}><path d="M4 9l1.3-4.2h13.4L20 9M4.5 9v10.5h15V9M4 9a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0" /></svg>
);
const AdvisorIcon = () => (
  <svg {...svgProps}><circle cx="12" cy="12" r="8.5" /><path d="M14.8 9.2l-1.9 4.9-4.9 1.9 1.9-4.9 4.9-1.9Z" /></svg>
);

const EMPLOYER: ToolAction[] = [
  { id: 'health', label: 'Company health check', icon: <HealthIcon /> },
  { id: 'talent', label: 'Talent marketplace', icon: <MarketIcon /> },
];
const EMPLOYEE: ToolAction[] = [{ id: 'career', label: 'Career advisor', icon: <AdvisorIcon /> }];

function Cluster({
  kind,
  label,
  icon,
  actions,
  open,
  onToggle,
  onAction,
}: {
  kind: string;
  label: string;
  icon: ReactNode;
  actions: ToolAction[];
  open: boolean;
  onToggle: () => void;
  onAction: () => void;
}) {
  return (
    <div className={`tdcluster ${open ? 'open' : ''}`}>
      <div className="tdactions">
        {actions.map((a, i) => (
          <button
            className="tdaction"
            key={a.id}
            onClick={onAction}
            style={{ transitionDelay: open ? `${0.03 + i * 0.05}s` : '0s' }}
          >
            <span className="tdactionlbl">{a.label}</span>
            <span className={`tdactionic ic-${a.id}`}>{a.icon}</span>
          </button>
        ))}
      </div>
      <span className="tdname">{label}</span>
      <button className={`tdfab td-${kind} ${open ? 'on' : ''}`} onClick={onToggle} aria-label={label} aria-expanded={open}>
        <span className="tdfabic">{open ? <CloseIcon /> : icon}</span>
      </button>
    </div>
  );
}

export function ToolsDock() {
  const selectedId = useAppStore((s) => s.selectedId);
  const compareOpen = useAppStore((s) => s.compareOpen);
  const [open, setOpen] = useState<'employer' | 'employee' | null>(null);

  if (selectedId || compareOpen) return null;
  const toggle = (k: 'employer' | 'employee') => setOpen((o) => (o === k ? null : k));

  return (
    <div className="toolsdock">
      <Cluster
        kind="employer"
        label="Employer tools"
        icon={<BuildingIcon />}
        actions={EMPLOYER}
        open={open === 'employer'}
        onToggle={() => toggle('employer')}
        onAction={() => setOpen(null)}
      />
      <Cluster
        kind="employee"
        label="Employee tools"
        icon={<PersonIcon />}
        actions={EMPLOYEE}
        open={open === 'employee'}
        onToggle={() => toggle('employee')}
        onAction={() => setOpen(null)}
      />
    </div>
  );
}
