export function disposeAll(disposers: Array<() => void>): void {
  for (const dispose of disposers.reverse()) {
    try {
      dispose();
    } catch {
      // Agent scope teardown may already have removed the registration.
    }
  }
}

export function safeDispose(dispose: (() => void) | undefined): void {
  if (dispose === undefined) return;
  try {
    dispose();
  } catch {
    // Agent scope teardown may already have removed the registration.
  }
}
