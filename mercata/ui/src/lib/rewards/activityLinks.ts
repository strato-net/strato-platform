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

  // Direct mint activities - goes to the Deposits page, Easy Savings tab
  if (lowerName.includes('direct mint')) {
    return '/dashboard/deposits?tab=easy-savings';
  }

  // CDP-related activities - goes to the Advanced page, Mint tab, Vaults sub-tab
  if (lowerName.includes('cdp')) {
    return '/dashboard/advanced?tab=mint&subtab=vaults';
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

  // Borrow activities - goes to the Borrow page
  if (lowerName.includes('borrow')) {
    return '/dashboard/borrow';
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
