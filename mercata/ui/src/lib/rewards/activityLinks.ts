/**
 * Hardcoded mapping of activity names to UI paths
 * This mapping should be updated whenever new activities are added or modified
 */

/**
 * Maps activity name patterns to their corresponding UI paths with optional query parameters
 * Uses partial matching to handle variations in activity names
 * Returns null if no match is found
 */
export const getActivityLink = (activityName: string): string | null => {
  if (!activityName) return null;

  const lowerName = activityName.toLowerCase();

  // Bridge-related activities - goes to the Fund page
  if (lowerName.includes('direct mint') || lowerName.includes('bridge')) {
    return '/dashboard/deposits';
  }

  // CDP-related activities - goes to the Borrow page, Vaults sub-tab
  if (lowerName.includes('cdp')) {
    return '/dashboard/borrow?subtab=vaults';
  }

  // Save USDST activities - goes to the dedicated Save USDST earn page
  if (lowerName.includes('save usdst') || lowerName.includes('saveusdst')) {
    return '/dashboard/earn-save';
  }

  // STRATO staking activities - goes to the Stake page
  // (matched on 'strato staking' so LP-staking style names don't collide)
  if (lowerName.includes('strato staking')) {
    return '/dashboard/earn-staking';
  }

  // ETH Carry Vault
  if (lowerName.includes('eth carry vault')) {
    return '/dashboard/earn-yield-vault?vault=eth-carry';
  }

  // wBTC Carry Vault
  if (lowerName.includes('wbtc carry vault')) {
    return '/dashboard/earn-yield-vault?vault=wbtc-carry';
  }

  // USDC Yield Vault
  if (lowerName.includes('usdc yield vault')) {
    return '/dashboard/earn-yield-vault?vault=usdc-yield';
  }

  // Vault activities - goes to the Vault page
  if (lowerName.includes('vault')) {
    return '/dashboard/vault';
  }
  
  // Swap LP activities - goes to the Advanced page, Swap Pools tab
  if (lowerName.includes('swap lp')) {
    return '/dashboard/advanced?tab=swap';
  }
  
  // Swap activities - goes to the Swap page
  if (lowerName.includes('swap')) {
    return '/dashboard/swap';
  }

  // Borrow activities - goes to the Advanced page, Borrow tab
  if (lowerName.includes('borrow')) {
    return '/dashboard/advanced?tab=borrow';
  }
  
  // Lending activities - goes to the Advanced page, Lending Pools tab
  if (lowerName.includes('lend')) {
    return '/dashboard/advanced?tab=lending';
  }

  // Deposit activities - goes to the Deposits page
  if (lowerName.includes('deposit')) {
    return '/dashboard/deposits';
  }
  
  // Withdrawal activities - goes to the Withdrawals page
  if (lowerName.includes('withdrawal')) {
    return '/dashboard/withdrawals';
  }

  // Safety Module activities - goes to the Advanced page, Safety tab
  if (lowerName.includes('safety')) {
    return '/dashboard/advanced?tab=safety';
  }

  // No match found
  return null;
};
