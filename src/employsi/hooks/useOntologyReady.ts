import { useEffect, useState } from "react";
import { onOntologyReady, ontologyLoaded } from "../lib/describeSkills";

/**
 * Re-renders once the O*NET ontology has finished loading.
 *
 * describeSkills is deliberately synchronous (see the note in
 * lib/describeSkills.ts) and returns [] until the 720KB ontology chunk lands.
 * A component that derives suggestions inside a useMemo therefore needs a
 * dependency that changes when it arrives, or the first query's results would
 * be stuck on the empty pass until the next keystroke.
 */
export function useOntologyReady(): boolean {
  const [ready, setReady] = useState(ontologyLoaded);
  useEffect(() => {
    if (ready) return;
    return onOntologyReady(() => setReady(true));
  }, [ready]);
  return ready;
}
