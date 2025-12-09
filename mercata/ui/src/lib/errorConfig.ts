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
  "/swap-pools/tokens": "Token Pair Error",
  "/swap-pools/positions": "LP Positions Error",
  "/swap-pools/liquidity": "Liquidity Operation Error",
  "/swap-pools": "Swap Error",
  "/swap": "Swap Transaction Error",
  
  // Bridge operations 
  "/bridge/config": "Bridge Configuration Error",
  "/bridge/bridgeableTokens": "Bridge Tokens Error",
  "/bridge/networkConfigs": "Bridge Network Config Error",
  "/bridge/requestWithdrawal": "Withdrawal Request Error",
  "/bridge/balance": "Bridge Balance Error",
  "/bridge/depositStatus": "Deposit Status Error",
  "/bridge/withdrawalStatus": "Withdrawal Status Error",
  "/bridge/requestAutoSave": "Automatic Lending Error",
  
  // User operations
  "/user/me": "User Profile Error",
  "/user/admin/vote": "Failed to cast vote",
  "/user/admin/issues": "Admin vote issueserror",
  "/user/admin": "Admin Operation Error",
  "/user": "User Error",
  
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