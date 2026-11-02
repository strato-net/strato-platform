import type { RouteDestination, SwapToken } from "@strato/shared-types";
import type { RouteConfirmation, RouteTokenSelection } from "@/interface/swap";

export const normalizeRouteAddress = (value: string) => value.toLowerCase().replace(/^0x/, "");

export function getRouteActionLabel(destination: RouteDestination = "token", external = false, bridgeOnly = false): string {
  if (external && bridgeOnly) return "deposit";
  const action = destination === "vault" ? "vault deposit" : destination === "savings" ? "savings deposit" : "swap";
  return external ? `bridge & ${action}` : action;
}

export function resolveRouteSelection(
  sources: SwapToken[],
  tokens: SwapToken[],
  tokenIn: string,
  tokenOut: string,
  poolTokens: string[] = []
): RouteTokenSelection {
  const input = normalizeRouteAddress(tokenIn);
  const output = normalizeRouteAddress(tokenOut);
  const pool = poolTokens.map(normalizeRouteAddress);
  const find = (list: SwapToken[], address: string) => list.find(token => normalizeRouteAddress(token.address) === address);
  const from = input ? find(sources, input)
    : pool.map(address => find(sources, address)).find(token => token && normalizeRouteAddress(token.address) !== output)
      ?? sources.find(token => normalizeRouteAddress(token.address) !== output);
  // The receive side starts empty unless the user picked a token, a pool deep
  // link implies it, or there is only one possible choice (native redemption).
  const candidates = tokens.filter(token => token.address !== from?.address);
  const to = output ? find(tokens, output)
    : pool.map(address => find(tokens, address)).find(token => token && token.address !== from?.address)
      ?? (candidates.length === 1 ? candidates[0] : undefined);
  if ((input && !from) || (output && !to)) return { tokenIn: from, tokenOut: to, error: "A linked token is unavailable. Choose another token." };
  if (from && to && normalizeRouteAddress(from.address) === normalizeRouteAddress(to.address)) {
    return { tokenIn: from, tokenOut: to, error: "Choose different pay and receive tokens." };
  }
  return { tokenIn: from, tokenOut: to };
}

// Warn when a quoted route returns materially less oracle value than it
// consumes. The 10% floor stays above normal fee and slippage noise; a
// mispriced pool along the route shows up as a far larger gap. User-side
// seatbelt only — it does not and cannot protect pool liquidity.
export const ROUTE_VALUE_LOSS_WARN_BPS = 1000n;

export function getRouteValueWarning(usdInWei?: bigint | null, usdOutWei?: bigint | null): string {
  if (!usdInWei || !usdOutWei || usdInWei <= 0n || usdOutWei <= 0n) return "";
  const lossBps = ((usdInWei - usdOutWei) * 10000n) / usdInWei;
  if (lossBps < ROUTE_VALUE_LOSS_WARN_BPS) return "";
  return `You would receive about ${(Number(lossBps) / 100).toFixed(1)}% less value than you send at current oracle prices. A pool on this route may be mispriced — review the route details before trading.`;
}

export function assertRouteConfirmation(confirmation: RouteConfirmation, selectionKey: string, now = Math.floor(Date.now() / 1000)): void {
  if (confirmation.selectionKey !== selectionKey) throw new Error("Trade details changed; review your trade again");
  if (!Number.isSafeInteger(confirmation.quote.deadline) || confirmation.quote.deadline <= now) {
    throw new Error("Quote expired; request a new quote");
  }
}
