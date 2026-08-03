export function Ticker() {
  return (
    <div className="sticky top-0 z-40 h-[92px] overflow-hidden bg-background">
      <iframe
        src="/skills-ticker.html"
        title="Skills in demand ticker"
        className="-mt-[72px] h-[140px] w-full border-0"
        style={{ background: "transparent" }}
      />
    </div>
  );
}
