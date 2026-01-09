import { getTokenMetadata } from "../helpers/cirrusHelpers";

export type TokenMap = Map<string, { name: string; symbol: string }>;

// Activity events we care about for user-facing activities
export const ACTIVITY_EVENTS = [
  'Deposited', 'DepositedOnBehalfOf', 'Withdrawn', 'WithdrawnCollateral',
  'Borrowed', 'Repaid', 'SuppliedCollateral', 'USDSTMinted', 'USDSTBurned',
  'LiquidationExecuted', 'Swap', 'AddLiquidity', 'RemoveLiquidity',
  'DepositCompleted', 'DepositInitiated', 'WithdrawalCompleted', 'WithdrawalRequested',
  'Staked', 'Redeemed', 'RewardsClaimed'
];

// Map event names to simplified activity types
export const EVENT_TYPE_MAP: Record<string, string> = {
  'Deposited': 'deposit', 'DepositedOnBehalfOf': 'deposit', 'DepositCompleted': 'deposit',
  'DepositInitiated': 'deposit', 'Withdrawn': 'withdraw', 'WithdrawnCollateral': 'withdraw',
  'WithdrawalCompleted': 'withdraw', 'WithdrawalRequested': 'withdraw',
  'Borrowed': 'borrow', 'Repaid': 'repay', 'SuppliedCollateral': 'collateral',
  'USDSTMinted': 'mint', 'USDSTBurned': 'burn', 'LiquidationExecuted': 'liquidation',
  'Swap': 'swap', 'AddLiquidity': 'liquidity', 'RemoveLiquidity': 'liquidity',
  'Staked': 'stake', 'Redeemed': 'redeem', 'RewardsClaimed': 'rewards'
};

// Default tokens for specific events
const EVENT_TOKEN_DEFAULTS: Record<string, string> = {
  'Borrowed': 'USDST', 'Repaid': 'USDST', 'USDSTMinted': 'USDST', 'USDSTBurned': 'USDST',
  'RewardsClaimed': 'CATA', 'Staked': 'USDST', 'Redeemed': 'USDST'
};

// Event titles
const EVENT_TITLES: Record<string, string> = {
  'Deposited': 'Deposit', 'DepositedOnBehalfOf': 'Deposit', 'DepositCompleted': 'Bridge Deposit',
  'DepositInitiated': 'Bridge Initiated', 'Withdrawn': 'Withdraw', 'WithdrawnCollateral': 'Withdraw Collateral',
  'WithdrawalCompleted': 'Bridge Withdraw', 'WithdrawalRequested': 'Withdraw Requested',
  'Borrowed': 'Borrow', 'Repaid': 'Repay', 'SuppliedCollateral': 'Supply Collateral',
  'USDSTMinted': 'Mint USDST', 'USDSTBurned': 'Burn USDST', 'LiquidationExecuted': 'Liquidation',
  'Swap': 'Swap', 'AddLiquidity': 'Add Liquidity', 'RemoveLiquidity': 'Remove Liquidity',
  'Staked': 'Stake', 'Redeemed': 'Redeem', 'RewardsClaimed': 'Claim Rewards'
};

// Fields to check for token symbols
const SYMBOL_FIELDS = [
  'tokenSymbol', 'symbol', 'assetSymbol', 'tokenInSymbol', 'tokenOutSymbol',
  'collateralSymbol', 'borrowedSymbol', '_symbol'
];

// Check if value looks like a blockchain address
const isAddress = (val: string): boolean => 
  typeof val === 'string' && /^[0-9a-fA-F]{40}$/.test(val);

// Format large wei amounts to human-readable decimals
export const formatAmount = (amount: string): string => {
  if (!amount || amount === '0') return '0';
  try {
    const num = BigInt(amount);
    if (num > BigInt(1e9)) {
      const formatted = Number(num) / 1e18;
      return formatted.toLocaleString('en-US', { maximumFractionDigits: 2 });
    }
    return Number(amount).toLocaleString('en-US', { maximumFractionDigits: 2 });
  } catch {
    return amount;
  }
};

// Look up token symbol from address using token map
const lookupTokenSymbol = (address: string, tokenMap: TokenMap): string => 
  tokenMap.get(address.toLowerCase())?.symbol || '';

// Extract token symbol from event attributes
const extractToken = (attrs: any, contractName: string, eventName: string, tokenMap: TokenMap): string => {
  // Check symbol fields first
  for (const field of SYMBOL_FIELDS) {
    const val = attrs?.[field];
    if (val && typeof val === 'string' && !isAddress(val)) return val;
  }
  
  // Look up token addresses
  for (const field of ['token', 'asset', 'tokenIn', 'tokenOut', 'collateral']) {
    const addr = attrs?.[field];
    if (addr && isAddress(addr)) {
      const symbol = lookupTokenSymbol(addr, tokenMap);
      if (symbol) return symbol;
    }
  }
  
  // Use defaults
  if (EVENT_TOKEN_DEFAULTS[eventName]) return EVENT_TOKEN_DEFAULTS[eventName];
  if (contractName?.includes('Vault') || contractName?.includes('CDP')) return 'USDST';
  if (contractName?.includes('Safety')) return 'USDST';
  
  return '';
};

// Build descriptive title
const buildTitle = (eventName: string, attrs: any, tokenMap: TokenMap): string => {
  const base = EVENT_TITLES[eventName] || eventName;
  
  if (eventName === 'Swap') {
    const inAddr = attrs?.tokenIn;
    const outAddr = attrs?.tokenOut;
    const inSymbol = inAddr && isAddress(inAddr) ? lookupTokenSymbol(inAddr, tokenMap) : (attrs?.tokenInSymbol || '');
    const outSymbol = outAddr && isAddress(outAddr) ? lookupTokenSymbol(outAddr, tokenMap) : (attrs?.tokenOutSymbol || '');
    if (inSymbol && outSymbol) return `Swap ${inSymbol} to ${outSymbol}`;
  }
  
  return base;
};

// Build description
const buildDescription = (eventName: string, attrs: any, contractName: string, tokenMap: TokenMap): string => {
  const token = extractToken(attrs, contractName, eventName, tokenMap);
  const amountFields = ['amount', 'assets', 'amountUSD', 'amountIn', 'amountOut', 'value', 'shares'];
  
  let rawAmount = '0';
  for (const field of amountFields) {
    if (attrs?.[field] && attrs[field] !== '0') {
      rawAmount = attrs[field];
      break;
    }
  }
  
  const amount = formatAmount(rawAmount);
  const action = EVENT_TITLES[eventName]?.toLowerCase() || eventName.toLowerCase();
  
  return token ? `${action} ${amount} ${token}` : `${action} ${amount}`;
};

// Extract all token addresses from events for batch lookup
export const extractTokenAddresses = (events: any[]): string[] => {
  const addresses = new Set<string>();
  const fields = ['tokenIn', 'tokenOut', 'token', 'asset', 'collateral'];
  
  events.forEach(event => {
    const attrs = event.attributes || {};
    fields.forEach(field => {
      const val = attrs[field];
      if (val && isAddress(val)) addresses.add(val.toLowerCase());
    });
  });
  
  return Array.from(addresses);
};

// Fetch token metadata for addresses
export const fetchTokenMetadata = async (
  accessToken: string, 
  addresses: string[]
): Promise<TokenMap> => {
  const tokenMap: TokenMap = new Map();
  if (!addresses.length) return tokenMap;
  
  try {
    const metadata = await getTokenMetadata(accessToken, addresses);
    // getTokenMetadata returns a Map<address, {name, symbol}>
    metadata.forEach((value: { name: string; symbol: string }, address: string) => {
      tokenMap.set(address.toLowerCase(), {
        name: value.name || '',
        symbol: value.symbol || ''
      });
    });
  } catch (err) {
    // Silently handle auth errors - just return empty map
    console.error('Failed to fetch token metadata:', err);
  }
  
  return tokenMap;
};

// Activity item interface
export interface ActivityItem {
  id: string;
  type: string;
  title: string;
  description: string;
  fromAddress: string;
  amount: string;
  token: string;
  timestamp: string;
  contractName: string;
  eventName: string;
}

// Transform raw event to ActivityItem
export const transformEvent = (event: any, tokenMap: TokenMap): ActivityItem => {
  const attrs = event.attributes || {};
  const eventName = event.event_name || '';
  const contractName = event.storage?.contract?.[0]?.contract_name || '';
  
  // Get amount
  const amountFields = ['amount', 'assets', 'amountUSD', 'amountIn', 'amountOut', 'value', 'shares'];
  let rawAmount = '0';
  for (const field of amountFields) {
    if (attrs[field] && attrs[field] !== '0') {
      rawAmount = attrs[field];
      break;
    }
  }
  
  return {
    id: event.id?.toString() || '',
    type: EVENT_TYPE_MAP[eventName] || 'other',
    title: buildTitle(eventName, attrs, tokenMap),
    description: buildDescription(eventName, attrs, contractName, tokenMap),
    fromAddress: event.transaction_sender || '',
    amount: formatAmount(rawAmount),
    token: extractToken(attrs, contractName, eventName, tokenMap),
    timestamp: event.block_timestamp || '',
    contractName,
    eventName
  };
};

