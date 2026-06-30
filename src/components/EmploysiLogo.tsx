type Props = { size?: number; reversed?: boolean; className?: string };

export function EmploysiMark({ size = 28, reversed = false, className }: Props) {
  const dark = reversed ? "#ffffff" : "#1c1c1e";
  const mid = reversed ? "rgba(255,255,255,0.78)" : "#48484a";
  const light = reversed ? "rgba(255,255,255,0.55)" : "#8e8e93";
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className={className} aria-hidden>
      <rect x="24" y="24" width="15" height="72" rx="7.5" fill={dark} />
      <rect x="24" y="24" width="40" height="15" rx="7.5" fill={light} />
      <rect x="24" y="52.5" width="55" height="15" rx="7.5" fill={mid} />
      <rect x="24" y="81" width="72" height="15" rx="7.5" fill={dark} />
    </svg>
  );
}

export function EmploysiLockup({ reversed = false, size = 28 }: { reversed?: boolean; size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <EmploysiMark size={size} reversed={reversed} />
      <span
        className="font-semibold tracking-[-0.025em] leading-none"
        style={{ fontSize: size * 0.78, color: reversed ? "#f3f3f4" : "#1c1c1e" }}
      >
        employsi
      </span>
    </span>
  );
}
