export function Ticker() {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 h-[92px] overflow-hidden border-t border-hairline bg-background/80 backdrop-blur">
      <iframe
        src="/skills-ticker.html"
        title="Skills in demand ticker"
        className="-mt-[24px] h-[140px] w-full border-0"
        style={{ background: "transparent" }}
      />
    </div>
  );
}
