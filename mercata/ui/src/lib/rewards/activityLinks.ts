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

  // CDP-related activities - goes to the Advanced page, Mint tab, Vaults sub-tab
  if (lowerName.includes('cdp')) {
    return '/dashboard/advanced?tab=mint&subtab=vaults';
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

  // Deposit activities - goes to the Deposits page
  if (lowerName.includes('deposit')) {
    return '/dashboard/deposits';
  }
  
  // Deposit activities - goes to the Withdrawals page
  if (lowerName.includes('withdrawal')) {
    return '/dashboard/withdrawals';
  }

  // Lending/Lend activities - goes to the Advanced page, Lending Pools tab
  if (lowerName.includes('lend')) {
    return '/dashboard/advanced?tab=lending';
  }

  // Safety Module activities - goes to the Advanced page, Safety tab
  if (lowerName.includes('safety')) {
    return '/dashboard/advanced?tab=safety';
  }

  // Liquidity Pool activities - goes to the Advanced page, Liquidations tab
  if (lowerName.includes('liquidity')) {
    return '/dashboard/advanced?tab=liquidations';
  }

  // No match found
  return null;
};
