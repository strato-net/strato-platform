import type { FilterConfig } from "./events.service";

// Canonical My Activity filter config per (contract_name, event_name) pair.
// The backend owns these so clients only send pair names and cannot inject
// arbitrary attribute filters into Cirrus queries.
export const ACTIVITY_FILTER_CONFIGS: Record<string, FilterConfig> = {
  "Token:Transfer": { type: "or", attributes: ["from", "to"], excludeProtocolAddresses: ["from", "to"] },
  "YieldVault:Transfer": { type: "or", attributes: ["from", "to"], excludeProtocolAddresses: ["from", "to"] },
  "SaveUSDSTVault:Transfer": { type: "or", attributes: ["from", "to"], excludeProtocolAddresses: ["from", "to"] },
  "SaveUSDSTVault:Deposit": { type: "single", attribute: "owner" },
  "SaveUSDSTVault:Withdraw": { type: "or", attributes: ["owner", "receiver"] },
  "MercataBridge:DepositCompleted": { type: "single", attribute: "stratoRecipient" },
  "StratoNativeBridge:NativeDepositCompleted": { type: "single", attribute: "stratoRecipient" },
  "MercataBridge:WithdrawalRequested": { type: "single", attribute: "user" },
  "StratoNativeBridge:NativeWithdrawalRequested": { type: "single", attribute: "stratoSender" },
  "CDPEngine:USDSTMinted": { type: "single", attribute: "owner" },
  "Pool:Swap": { type: "single", attribute: "sender" },
  "Pool:AddLiquidity": { type: "single", attribute: "provider" },
  // V3 events carry both the caller (sender/owner) and the recipient; either can be "me".
  // Positions held as NFTs act through PositionManagerV3, so pool-level Mint/Burn/Collect
  // attribute to the MANAGER (an internal address): those rows are excluded here and the
  // user-facing record comes from the manager's own events below. Legacy positions
  // (owner = the user) keep flowing through the pool-level events.
  "PoolV3:Swap": { type: "or", attributes: ["sender", "recipient"] },
  "PoolV3:Mint": { type: "or", attributes: ["sender", "owner"], excludeProtocolAddresses: ["owner"] },
  "PoolV3:Burn": { type: "single", attribute: "owner", excludeProtocolAddresses: ["owner"] },
  "PoolV3:Collect": { type: "or", attributes: ["owner", "recipient"], excludeProtocolAddresses: ["owner"] },
  // Position-NFT activity (PositionManagerV3 events, platform-extended with sender/pool)
  "PositionManagerV3:IncreaseLiquidity": { type: "single", attribute: "sender" },
  "PositionManagerV3:DecreaseLiquidity": { type: "single", attribute: "sender" },
  "PositionManagerV3:Collect": { type: "or", attributes: ["sender", "recipient"] },
  "Rewards:RewardsClaimed": { type: "single", attribute: "user" },
  "StratoStaking:Staked": { type: "single", attribute: "user" },
  "StratoStaking:StakeMoved": { type: "single", attribute: "user" },
  "StratoStaking:UnbondingStarted": { type: "single", attribute: "user" },
  "StratoStaking:UnbondedWithdrawn": { type: "single", attribute: "user" },
  "StratoStaking:DelegatorRewardsClaimed": { type: "single", attribute: "user" },
  "StratoStaking:SelfBonded": { type: "single", attribute: "operator" },
  "StratoStaking:SelfBondUnbondingStarted": { type: "single", attribute: "operator" },
  "StratoStaking:OperatorRewardsClaimed": { type: "single", attribute: "operator" },
  "StratoStaking:DelegatorFeesClaimed": { type: "single", attribute: "user" },
  "StratoStaking:OperatorFeesClaimed": { type: "single", attribute: "operator" },
  "StratoStaking:ValidatorSynced": { type: "single", attribute: "operator" },
  "StratoStaking:ValidatorEvicted": { type: "single", attribute: "operator" },
  "StratoStaking:ValidatorJailed": { type: "single", attribute: "operator" },
  "StratoStaking:ExitRequested": { type: "single", attribute: "operator" },
  "StratoStaking:ExitCancelled": { type: "single", attribute: "operator" },
  "LendingPool:Borrowed": { type: "single", attribute: "user" },
  "LendingPool:Deposited": { type: "single", attribute: "user" },
  "Escrow:Redeemed": { type: "or", attributes: ["sender", "recipient"] },
  "Vault:Deposited": { type: "single", attribute: "user" },
  "Vault:Withdrawn": { type: "single", attribute: "user" },
  "Vault:WithdrawalPayout": { type: "single", attribute: "user" },
  "MetalForge:MetalMinted": { type: "single", attribute: "buyer" },
  "YieldVault:Deposit": { type: "single", attribute: "owner" },
  "YieldVault:Withdraw": { type: "or", attributes: ["owner", "receiver"] },
  "YieldVault:WithdrawalRequested": { type: "single", attribute: "owner" },
  "YieldVault:WithdrawalClaimed": { type: "single", attribute: "owner" },
};
