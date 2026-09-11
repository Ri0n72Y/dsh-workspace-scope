import React from "react";

let modalOpen = false;
const modalListeners = new Set<() => void>();

function setModal(open: boolean): void {
  modalOpen = open;
  for (const listener of modalListeners) listener();
}

export function useModalOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = React.useState(modalOpen);
  React.useEffect(() => {
    const listener = (): void => setOpenState(modalOpen);
    modalListeners.add(listener);
    return () => {
      modalListeners.delete(listener);
    };
  }, []);
  return [open, setModal];
}
