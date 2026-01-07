// Activity transformation helpers

export type TokenMap = Map<string, { name: string; symbol: string }>;

// Constants
const ADDRESS_FIELDS = ['tokenIn', 'tokenOut', 'token', 'asset', 'token0', 'token1', 'srcToken', 'dstToken'];
const SYMBOL_FIELDS = ['tokenSymbol', 'symbol', 'tokenOutSymbol', 'tokenInSymbol', 'assetSymbol', 'srcSymbol', 'dstSymbol', 'name'];

export const ACTIVITY_EVENTS = [
  "Deposited", "DepositedOnBehalfOf", "Withdrawn", "WithdrawnCollateral",
  "Borrowed", "Repaid", "SuppliedCollateral", "USDSTMinted", "USDSTBurned", 
  "LiquidationExecuted", "Swap", "AddLiquidity", "RemoveLiquidity",
  "DepositCompleted", "DepositInitiated", "WithdrawalCompleted", "WithdrawalRequested",
  "Staked", "Redeemed", "RewardsClaimed"
];

export const EVENT_TYPE_MAP: Record<string, string> = {
  Deposited: "deposit", DepositedOnBehalfOf: "deposit", SuppliedCollateral: "deposit",
  Withdrawn: "withdraw", WithdrawnCollateral: "withdraw",
  USDSTMinted: "borrow", Borrowed: "borrow", USDSTBurned: "repay", Repaid: "repay",
  Swap: "swap", AddLiquidity: "liquidity", RemoveLiquidity: "liquidity",
  DepositCompleted: "bridge", DepositInitiated: "bridge",
  WithdrawalCompleted: "bridge", WithdrawalRequested: "bridge",
  Staked: "stake", Redeemed: "unstake", RewardsClaimed: "rewards", LiquidationExecuted: "liquidation",
};

const TOKEN_DEFAULTS: Record<string, string> = {
  Borrowed: "USDST", USDSTMinted: "USDST", Repaid: "USDST", USDSTBurned: "USDST",
  RewardsClaimed: "CATA", Staked: "CATA", Redeemed: "CATA", SuppliedCollateral: "USDST",
};

const TITLES: Record<string, string> = {
  Deposited: "Deposit", DepositedOnBehalfOf: "Deposit",
  Withdrawn: "Withdraw", WithdrawnCollateral: "Withdraw Collateral",
  Borrowed: "Borrow USDST", Repaid: "Repay USDST", USDSTMinted: "Mint USDST", USDSTBurned: "Burn USDST",
  Swap: "Swap", AddLiquidity: "Add Liquidity", RemoveLiquidity: "Remove Liquidity",
  DepositCompleted: "Bridge In", DepositInitiated: "Bridge In (Pending)",
  WithdrawalCompleted: "Bridge Out", WithdrawalRequested: "Bridge Out (Pending)",
  Staked: "Stake", Redeemed: "Unstake", RewardsClaimed: "Rewards Claimed",
  LiquidationExecuted: "Liquidation", SuppliedCollateral: "Supply Collateral",
};

// Helpers
const isAddr = (v: string) => v && (v.startsWith("0x") || (v.length > 20 && /^[a-f0-9]+$/i.test(v)));
const normalize = (addr: string) => addr?.toLowerCase().replace('0x', '') || "";
const lookup = (addr: string, map: TokenMap) => map.get(normalize(addr))?.symbol || "";

export const formatAmount = (amount: string): string => {
  if (!amount || amount === "0") return "0";
  try {
    const n = BigInt(amount);
    if (n > BigInt(1e9)) {
      const v = Number(n) / 1e18;
      return v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) 
           : v >= 1 ? v.toFixed(2) : v >= 0.0001 ? v.toFixed(4) : v.toFixed(6);
    }
    return Number(amount) >= 1000 ? Number(amount).toLocaleString('en-US', { maximumFractionDigits: 2 }) : amount;
  } catch { return amount; }
};

export const extractTokenAddresses = (events: any[]): string[] => {
  const addrs = new Set<string>();
  events.forEach(e => ADDRESS_FIELDS.forEach(f => {
    const v = e.attributes?.[f];
    if (v && typeof v === 'string' && (v.startsWith('0x') || v.length === 40)) addrs.add(normalize(v));
  }));
  return [...addrs];
};

const getToken = (attrs: any, contract: string, event: string, map: TokenMap): string => {
  // 1. Check symbol fields
  for (const f of SYMBOL_FIELDS) if (attrs[f] && !isAddr(attrs[f]) && attrs[f].length <= 10) return attrs[f];
  // 2. Lookup from addresses
  for (const f of ADDRESS_FIELDS) if (attrs[f] && isAddr(attrs[f])) { const s = lookup(attrs[f], map); if (s) return s; }
  // 3. Event defaults
  if (TOKEN_DEFAULTS[event]) return TOKEN_DEFAULTS[event];
  // 4. Contract patterns
  if (contract.includes("Vault")) return "USDST";
  if (/usdc/i.test(contract)) return "USDC";
  if (contract.includes("ETH") && !contract.includes("Bridge")) return "ETH";
  if (contract.includes("CATA")) return "CATA";
  return "";
};

export interface ActivityItem {
  id: string; type: string; title: string; description: string;
  fromAddress: string; amount: string; token: string;
  timestamp: string; contractName: string; eventName: string;
}

export const transformEvent = (event: any, tokenMap: TokenMap = new Map()): ActivityItem => {
  const a = event.attributes || {};
  const contract = event.storage?.contract?.[0]?.contract_name || "";
  const name = event.event_name || "";
  
  const inSym = a.tokenInSymbol || lookup(a.tokenIn, tokenMap);
  const outSym = a.tokenOutSymbol || lookup(a.tokenOut, tokenMap);
  const token = name === "Swap" ? (outSym || getToken(a, contract, name, tokenMap)) : getToken(a, contract, name, tokenMap);
  const rawAmt = a.amount || a.assets || a.amountOut || a.amountIn || a.value || a.shares || "0";
  const amt = formatAmount(rawAmt);
  
  // Build title
  let title = TITLES[name] || name.replace(/([A-Z])/g, ' $1').trim();
  if (name === "Swap" && inSym && outSym) title = `Swap ${inSym} to ${outSym}`;
  else if (name === "Swap" && inSym) title = `Swap ${inSym}`;
  else if (name === "Swap" && outSym) title = `Swap to ${outSym}`;

  // Build description
  const descMap: Record<string, string> = {
    Deposited: `Deposited ${amt} ${token}`, DepositedOnBehalfOf: `Deposited ${amt} ${token}`,
    Withdrawn: `Withdrew ${amt} ${token}`, WithdrawnCollateral: `Withdrew ${amt} ${token}`,
    Swap: `Swapped ${amt} ${inSym}`, Borrowed: `Borrowed ${amt} USDST`, USDSTMinted: `Borrowed ${amt} USDST`,
    Repaid: `Repaid ${amt} USDST`, USDSTBurned: `Repaid ${amt} USDST`,
    SuppliedCollateral: `Added collateral ${amt} ${token}`,
    DepositCompleted: `Bridged ${amt} ${token}`, DepositInitiated: `Bridged ${amt} ${token}`,
    WithdrawalCompleted: "To external chain", WithdrawalRequested: "To external chain",
    Staked: `Staked ${amt} ${token}`, Redeemed: `Unstaked ${amt} ${token}`,
    RewardsClaimed: `Claimed ${amt} rewards`,
  };
  const desc = descMap[name] || (contract !== "Ownable" && contract !== "Proxy" ? contract : "");

  return {
    id: String(event.id || Math.random()),
    type: EVENT_TYPE_MAP[name] || "other",
    title, description: desc.trim(),
    fromAddress: a.owner || a.user || a.sender || a.from || event.transaction_sender || "",
    amount: amt, token, timestamp: event.block_timestamp || "", contractName: contract, eventName: name,
  };
};
