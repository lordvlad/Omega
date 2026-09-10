/**
 * Whether this device has a network at all.
 *
 * Distinct from whether the omega server is reachable, which the AG-UI socket
 * already reports. Both can fail, and they fail differently: a dropped socket
 * on a working network usually means the server restarted and a prompt will
 * still be accepted once it returns, whereas a device with no network cannot
 * deliver anything. Saying "reconnecting, messages still send" to someone in a
 * tunnel is simply wrong, so the two are tracked apart.
 *
 * `navigator.onLine` only ever proves the negative: `false` means there is
 * definitively no route, `true` means a link exists and says nothing about
 * whether anything answers on it. That is exactly the direction this is used
 * in — to explain a failure already observed, never to predict success.
 */
import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function snapshot(): boolean {
  return navigator.onLine;
}

/** Server-side render has no navigator; assume a network until told otherwise. */
function serverSnapshot(): boolean {
  return true;
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
