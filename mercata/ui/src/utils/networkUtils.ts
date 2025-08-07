/**
 * Utility functions for network validation and error messages
 */

export interface NetworkErrorParams {
  networkName: string;
  tokenSymbol: string;
  direction: 'in' | 'out';
}

/**
 * Generates consistent network error messages for bridge operations
 */
export const getNetworkErrorMessage = ({ networkName, tokenSymbol, direction }: NetworkErrorParams): string => {
  return `Please switch to ${networkName} network to bridge ${direction} ${tokenSymbol}`;
};

/**
 * Alternative function for when token is not selected
 */
export const getTokenSelectionErrorMessage = (direction: 'in' | 'out'): string => {
  return `Please select a token to bridge ${direction}`;
};