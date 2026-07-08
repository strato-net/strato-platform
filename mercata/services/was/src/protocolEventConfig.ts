import { TraceLot } from "./types";

export interface ProtocolEventConfig {
  eventName: string;
  source?: TraceLot["source"];
  matchingStatus: "enabled" | "candidate" | "anchor" | "ignored";
  reason: string;
}

export const PROTOCOL_EVENT_CONFIGS: ProtocolEventConfig[] = [
  {
    eventName: "Swap",
    source: "swap",
    matchingStatus: "enabled",
    reason: "Swap output transfers map to tokenOut/amountOut and trace back to tokenIn/amountIn.",
  },
  {
    eventName: "MetalMinted",
    source: "metal_mint",
    matchingStatus: "enabled",
    reason: "Metal output transfers map to metalToken/metalAmount and trace back to payToken/payAmount.",
  },
  {
    eventName: "DirectPSMMinted",
    source: "psm",
    matchingStatus: "enabled",
    reason: "PSM mint transfers map to mintAmount and trace back to againstToken/depositAmount.",
  },
  {
    eventName: "USDSTMinted",
    source: "cdp_mint",
    matchingStatus: "enabled",
    reason: "USDST mint transfers can be detected, but CDP collateral tracing remains unknown until verified.",
  },
  {
    eventName: "RewardsClaimed",
    source: "rewards",
    matchingStatus: "enabled",
    reason: "Rewards transfers can be detected, but reward source provenance remains unknown until verified.",
  },
  {
    eventName: "DepositCompleted",
    matchingStatus: "anchor",
    reason: "Standard bridge deposit trust anchor.",
  },
  {
    eventName: "NativeDepositCompleted",
    matchingStatus: "anchor",
    reason: "Native bridge deposit trust anchor.",
  },
  {
    eventName: "WithdrawalPayout",
    matchingStatus: "candidate",
    reason: "Yield vault withdrawal output event observed in debug dumps.",
  },
  {
    eventName: "WithdrawalPaidImmediately",
    matchingStatus: "candidate",
    reason: "Yield vault instant withdrawal output event observed in contracts/debug dumps.",
  },
  {
    eventName: "WithdrawalClaimed",
    matchingStatus: "candidate",
    reason: "Yield vault queued withdrawal claim event.",
  },
  {
    eventName: "RemoveLiquidity",
    matchingStatus: "candidate",
    reason: "Pool liquidity removal can produce user token outputs.",
  },
  {
    eventName: "RemoveLiquidityOne",
    matchingStatus: "candidate",
    reason: "Stable pool single-asset liquidity removal can produce user token outputs.",
  },
  {
    eventName: "RemoveLiquidityImbalance",
    matchingStatus: "candidate",
    reason: "Stable pool imbalanced liquidity removal can produce user token outputs.",
  },
  {
    eventName: "AddLiquidity",
    matchingStatus: "candidate",
    reason: "Liquidity additions can mint LP token outputs.",
  },
  {
    eventName: "Deposited",
    matchingStatus: "candidate",
    reason: "Lending/vault deposit event can mint receipt/share token outputs.",
  },
  {
    eventName: "DepositedOnBehalfOf",
    matchingStatus: "candidate",
    reason: "Lending deposit-on-behalf event can mint receipt token outputs.",
  },
  {
    eventName: "Withdrawn",
    matchingStatus: "candidate",
    reason: "Lending/CDP/vault withdraw event can produce asset outputs.",
  },
  {
    eventName: "Deposit",
    matchingStatus: "candidate",
    reason: "ERC4626 deposit event can mint share token outputs.",
  },
  {
    eventName: "Withdraw",
    matchingStatus: "candidate",
    reason: "ERC4626 withdraw event can produce asset outputs.",
  },
  {
    eventName: "CollateralDeposited",
    matchingStatus: "candidate",
    reason: "CDP collateral movement affects provenance but output semantics need verification.",
  },
  {
    eventName: "CollateralWithdrawn",
    matchingStatus: "candidate",
    reason: "CDP collateral withdrawal can produce asset outputs.",
  },
  {
    eventName: "CollateralAdded",
    matchingStatus: "candidate",
    reason: "CDP engine collateral event observed in debug dumps.",
  },
  {
    eventName: "CollateralRemoved",
    matchingStatus: "candidate",
    reason: "CDP engine collateral event observed in debug dumps.",
  },
  {
    eventName: "SuppliedCollateral",
    matchingStatus: "candidate",
    reason: "CDP collateral supply event observed in debug dumps.",
  },
  {
    eventName: "WithdrawnCollateral",
    matchingStatus: "candidate",
    reason: "CDP collateral withdrawal event observed in debug dumps.",
  },
  {
    eventName: "USDSTBurned",
    matchingStatus: "candidate",
    reason: "CDP debt repayment event affects provenance of burned/moved USDST.",
  },
  {
    eventName: "Borrowed",
    matchingStatus: "candidate",
    reason: "Lending borrow can produce asset outputs.",
  },
  {
    eventName: "Repaid",
    matchingStatus: "candidate",
    reason: "Lending repayment can explain transfers into protocol contracts.",
  },
  {
    eventName: "Locked",
    matchingStatus: "candidate",
    reason: "Native custody lock event can explain native bridge withdrawals.",
  },
  {
    eventName: "Unlocked",
    matchingStatus: "candidate",
    reason: "Native custody unlock event can explain native bridge deposits.",
  },
  {
    eventName: "AutoSaved",
    matchingStatus: "candidate",
    reason: "Bridge deposit auto-save transforms freshly minted funds into lending receipt assets.",
  },
  {
    eventName: "AutoForged",
    matchingStatus: "candidate",
    reason: "Bridge deposit auto-forge transforms freshly minted funds into metal assets.",
  },
  {
    eventName: "TopUpRequested",
    matchingStatus: "candidate",
    reason: "Credit card top-up creates withdrawal request and related escrow transfer flow.",
  },
  {
    eventName: "WithdrawalRequested",
    matchingStatus: "candidate",
    reason: "Bridge and vault withdrawal request events can explain escrow/request transfers.",
  },
  {
    eventName: "WithdrawalCompleted",
    matchingStatus: "candidate",
    reason: "Bridge withdrawal completion can explain burn/finalization transfers.",
  },
  {
    eventName: "WithdrawalAborted",
    matchingStatus: "candidate",
    reason: "Bridge withdrawal abort can explain refund transfers.",
  },
  {
    eventName: "NativeWithdrawalCompleted",
    matchingStatus: "candidate",
    reason: "Native withdrawal completion can explain finalized native bridge transfers.",
  },
  {
    eventName: "NativeWithdrawalAborted",
    matchingStatus: "candidate",
    reason: "Native withdrawal abort can explain refund/unlock transfers.",
  },
  {
    eventName: "IssueExecuted",
    matchingStatus: "ignored",
    reason: "Governance/admin execution metadata; useful context but not a direct provenance edge.",
  },
  {
    eventName: "Transfer",
    matchingStatus: "ignored",
    reason: "Base event already fetched separately as funding evidence.",
  },
];

export const PROTOCOL_ASSOCIATION_EVENT_NAMES = PROTOCOL_EVENT_CONFIGS
  .filter((config) => config.matchingStatus !== "ignored")
  .map((config) => config.eventName);

export const ENABLED_PROTOCOL_OUTPUT_EVENT_NAMES = PROTOCOL_EVENT_CONFIGS
  .filter((config) => config.matchingStatus === "enabled")
  .map((config) => config.eventName);

export const sourceForProtocolEvent = (
  eventName: string,
): TraceLot["source"] | undefined =>
  PROTOCOL_EVENT_CONFIGS.find((config) => config.eventName === eventName)?.source;
