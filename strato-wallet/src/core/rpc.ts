// Minimal JSON-RPC client for a STRATO node's EVM /rpc endpoint. Used both to
// proxy read methods from dApps and by the EVM tx path (getTransactionCount,
// sendRawTransaction).

import { RpcError, RpcErrors } from "@/src/messaging/protocol";

let nextId = 1;

export async function rpcCall<T = unknown>(
  rpcUrl: string,
  method: string,
  params: unknown[] = []
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    });
  } catch (e) {
    throw new RpcError(
      RpcErrors.disconnected.code,
      `Network request to ${rpcUrl} failed: ${(e as Error).message}`
    );
  }
  if (!res.ok) {
    throw new RpcError(RpcErrors.internal.code, `RPC HTTP ${res.status}`);
  }
  const json = await res.json();
  if (json.error) {
    throw new RpcError(
      json.error.code ?? RpcErrors.internal.code,
      json.error.message ?? "RPC error",
      json.error.data
    );
  }
  return json.result as T;
}
