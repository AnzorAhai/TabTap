import { useCallback, useSyncExternalStore } from "react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

// Browsers fire this once, possibly before React has mounted, so it's caught at load.
let installEvent: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installEvent = event as InstallPromptEvent;
  notify();
});
window.addEventListener("appinstalled", () => {
  installEvent = null;
  notify();
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A function that shows the browser's "install app" dialog, or null when it isn't on offer. */
export function useInstallPrompt(): (() => void) | null {
  const available = useSyncExternalStore(subscribe, () => installEvent !== null);
  const install = useCallback(() => {
    void installEvent?.prompt();
    installEvent = null;
    notify();
  }, []);
  return available ? install : null;
}

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
