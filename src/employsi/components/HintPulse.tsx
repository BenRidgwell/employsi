import { useAppStore } from '../state/store';

export function HintPulse() {
  const interacted = useAppStore((s) => s.interacted);
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  return (
    <div className={`hintpulse ${interacted ? 'gone' : ''} ${zoomedOut ? 'zoomhide' : ''}`}>
      Drag to pan · scroll to zoom · right-drag to rotate · click a company pin
    </div>
  );
}
