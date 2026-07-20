import { useEffect, useState } from "react";
import { useAuthContext } from "../providers/AuthProvider";
import { createBackendActor } from "./actor";

export function useBackendActor() {
  const { identity } = useAuthContext();
  const [actor, setActor] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    createBackendActor(identity).then((a) => {
      if (!cancelled) setActor(a);
    });
    return () => { cancelled = true; };
  }, [identity]);

  return actor;
}
