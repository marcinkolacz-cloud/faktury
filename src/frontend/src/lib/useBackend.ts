import { useEffect, useState } from "react";
import { useAuthContext } from "../providers/AuthProvider";
import { createBackendActor } from "./actor";

export function useBackendActor() {
  const { identity, isInitializing } = useAuthContext();
  const [actor, setActor] = useState<any>(null);

  useEffect(() => {
    if (isInitializing) return;
    let cancelled = false;
    createBackendActor(identity).then((a) => {
      if (!cancelled) setActor(a);
    });
    return () => { cancelled = true; };
  }, [identity, isInitializing]);

  return actor;
}
