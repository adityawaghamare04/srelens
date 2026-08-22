import { useCallback, useEffect, useRef, useState } from "react";
import { getObject, type K8sObject } from "@srelens/core";

export type ObjectStatus = "loading" | "ready" | "error";

export interface ObjectResource {
  object?: K8sObject;
  status: ObjectStatus;
  error?: string;
  reload(): void;
}

/**
 * Loads a single object by context/kind/namespace/name. Both the peek pane
 * and the full tab drive the same hook so they can never disagree about what
 * they're showing. Follows useResource's generation-counter shape: a result
 * arriving after the target changed or the component unmounted is dropped.
 */
export function useObject(context: string, kind: string, namespace: string | null, name: string): ObjectResource {
  const [state, setState] = useState<Omit<ObjectResource, "reload">>({ status: "loading" });
  const gen = useRef(0);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const mine = ++gen.current;
    setState({ status: "loading" });
    getObject(context, kind, namespace, name).then(
      (result) => {
        if (gen.current !== mine) return;
        if (result.error) {
          setState({ status: "error", error: result.error });
          return;
        }
        setState({ status: "ready", object: result.object });
      },
      (e: unknown) => {
        if (gen.current !== mine) return;
        setState({ status: "error", error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => { if (gen.current === mine) gen.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, kind, namespace, name, tick]);

  return { ...state, reload };
}
