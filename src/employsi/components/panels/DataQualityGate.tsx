import { useAppStore } from "../../state/store";
import { DataQualityPane } from "./DataQualityPane";

/**
 * Mounts the data-quality pane only while an administrator has it open.
 *
 * A separate component so the pane's module — and the archive query inside it —
 * is never even instantiated for an end user. The server function is what
 * actually refuses them; this just avoids asking.
 */
export function DataQualityGate() {
  const open = useAppStore((s) => s.dataQualityOpen);
  const isAdmin = useAppStore((s) => s.role) === "admin";
  const close = useAppStore((s) => s.closeDataQuality);
  if (!open || !isAdmin) return null;
  return <DataQualityPane onClose={close} />;
}
