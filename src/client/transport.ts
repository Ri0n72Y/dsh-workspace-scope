declare const host: any;

export function callHost(method: string, args: unknown): Promise<any> {
  if (typeof host !== "undefined") return host.call(method, args);
  const handle = async (response: Response): Promise<any> => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<any>;
  };
  if (method === "overview") {
    const sessionId = (args as { sessionId?: string })?.sessionId ?? "";
    return fetch(
      `/api/dsh-workspace-scope/overview?sessionId=${encodeURIComponent(sessionId)}`,
    ).then(handle);
  }
  return fetch("/api/dsh-workspace-scope/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  }).then(handle);
}
