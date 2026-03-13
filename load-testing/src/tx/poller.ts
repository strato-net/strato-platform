import { ApiClient, TxResultResponse, PollingConfig } from "../types";

function isTerminal(status: string): boolean {
  return status === "Success" || status === "Failure";
}

export async function pollForResults(
  bloc: ApiClient,
  hashes: string[],
  polling: PollingConfig,
): Promise<TxResultResponse[]> {
  const deadline = Date.now() + polling.timeout;

  while (true) {
    const results = await bloc.post<TxResultResponse[]>(
      "/transactions/results",
      hashes,
    );

    if (!Array.isArray(results)) {
      throw new Error("Invalid poll response: expected array");
    }

    const allTerminal = results.every((r) => isTerminal(r.status));
    if (allTerminal) {
      return results;
    }

    if (Date.now() >= deadline) {
      // Return what we have — caller will mark non-terminal as timeout
      return results;
    }

    await new Promise((r) => setTimeout(r, polling.interval));
  }
}
