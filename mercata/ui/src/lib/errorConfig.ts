// Error configuration for API endpoints
export const API_ERROR_TITLES: Record<string, string> = {
  // Token operations
  "/tokens/transfer": "Transfer Error",
  "/tokens/balance": "Balance Error",
  "/tokens/approve": "Token Approval Error",
  "/tokens/transferFrom": "Transfer From Error",
  "/tokens/setStatus": "Token Status Error",
  "/tokens": "Token Error",
  
  // Lending operations
  "/lending/collateral": "Supply Collateral Error",
  "/lending/loans": "Loan Error",
  "/lending/pools/liquidity": "Liquidity Error",
  "/lending/pools": "Pool Error",
  "/lending/liquidity": "Liquidity Error",
  "/lending/liquidate": "Liquidation Error",
  "/lending/admin/configure-asset": "Asset Configuration Error",
  "/lend/pools": "Lending Pool Error",
  "/lend/liquidate": "Liquidation Error",
  "/lend/admin/configure-asset": "Asset Configuration Error",
  "/lend/liquidate/near-unhealthy": "Liquidation Watchlist Error",
  
  // Oracle operations
  "/oracle/price": "Price Error",
  
  // Swap operations
  "/swap-pools": "Swap Error",
  "/swap-pools/tokens": "Token Pair Error",
  "/swap-pools/positions": "LP Positions Error",
  "/swap": "Swap Transaction Error",
  "/swap/quote": "Swap Quote Error",
  "/swap-pools/liquidity": "Liquidity Operation Error",
  
  // OnRamp operations
  "/onramp": "OnRamp Error",
  "/onramp/buy": "Buy Error",
  "/onramp/sell": "Sell Error",
  "/onramp/lock": "Lock Error",
  "/onramp/unlock": "Unlock Error",
  "/onramp/addPaymentProvider": "Add Payment Provider Error",
  "/onramp/removePaymentProvider": "Remove Payment Provider Error",
  "/onramp/cancelListing": "Cancel Listing Error",
  
  // Bridge operations 
  "/bridge/config": "Bridge Configuration Error",
  "/bridge/bridgeableTokens": "Bridge Tokens Error",
  "/bridge/networkConfigs": "Bridge Network Config Error",
  "/bridge/bridgeIn": "Bridge In Error",
  "/bridge/bridgeOut": "Bridge Out Error",
  "/bridge/balance": "Bridge Balance Error",
  "/bridge/depositStatus": "Deposit Status Error",
  "/bridge/withdrawalStatus": "Withdrawal Status Error",
  
  // User operations
  "/user": "User Error",
  "/user/me": "User Profile Error",
  
  // Default
  "default": "API Error"
};

// Helper function to get error title from URL
export function getErrorTitle(url: string): string {
  // Find the matching endpoint
  for (const [endpoint, title] of Object.entries(API_ERROR_TITLES)) {
    if (url.includes(endpoint)) {
      return title;
    }
  }
  
  // Return default if no match found
  return API_ERROR_TITLES.default;
} 