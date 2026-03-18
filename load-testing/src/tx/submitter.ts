import { ApiClient, BuiltTx, TxSubmitResponse } from "../types";

export async function submitBatch(
  strato: ApiClient,
  builtTx: BuiltTx,
  resolve: boolean = false,
): Promise<TxSubmitResponse[]> {
  const url = resolve
    ? "/transaction/parallel?resolve=true"
    : "/transaction/parallel";

  const response = await strato.post<TxSubmitResponse[]>(url, builtTx);

  if (!Array.isArray(response) || response.length === 0) {
    throw new Error("Invalid transaction response: expected non-empty array");
  }

  for (const [i, r] of response.entries()) {
    if (!r?.hash) {
      throw new Error(`Invalid tx result at index ${i}: missing hash`);
    }
  }

  return response;
}
