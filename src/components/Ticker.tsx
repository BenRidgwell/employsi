export function Ticker() {
  return (
    <div className="sticky top-0 z-40 bg-background">
      <iframe
        src="/skills-ticker.html"
        title="Skills in demand ticker"
        className="h-[72px] w-full border-0"
        style={{ background: "transparent" }}
      />
    </div>
  );
}
