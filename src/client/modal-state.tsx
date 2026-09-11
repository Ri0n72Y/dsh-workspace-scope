import { useSyncExternalStore } from "react";

let modalOpen = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setModalOpen(open: boolean): void {
  if (open === modalOpen) return;
  modalOpen = open;
  for (const listener of [...listeners]) listener();
}

// ponytail: one boolean shared across a session-scoped seat and a root-scoped
// overlay does not justify a cross-scope DSH store bridge. Move this state to a
// shared slot store if the shared UI state grows beyond modal visibility.
export function useModalOpen(): boolean {
  return useSyncExternalStore(subscribe, () => modalOpen);
}
