// Control channel between the popup UI and the background service worker, over
// browser.runtime.sendMessage. The popup calls `callBackground(method, ...args)`;
// the background dispatches to a handler registry (see background.ts).

export interface ControlMessage {
  kind: "control";
  method: string;
  args: unknown[];
}

export interface ControlOk {
  ok: true;
  result: unknown;
}
export interface ControlErr {
  ok: false;
  error: string;
}
export type ControlResponse = ControlOk | ControlErr;

export function isControlMessage(m: unknown): m is ControlMessage {
  return !!m && typeof m === "object" && (m as ControlMessage).kind === "control";
}

export async function callBackground<T = unknown>(
  method: string,
  ...args: unknown[]
): Promise<T> {
  const res = (await browser.runtime.sendMessage({
    kind: "control",
    method,
    args,
  } satisfies ControlMessage)) as ControlResponse;
  if (!res) throw new Error("No response from background");
  if (!res.ok) throw new Error(res.error);
  return res.result as T;
}
