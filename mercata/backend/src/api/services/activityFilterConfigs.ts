import type { FilterConfig } from "./events.service";

// Canonical My Activity filter config per (contract_name, event_name) pair.
// The backend owns these so clients only send pair names and cannot inject
// arbitrary attribute filters into Cirrus queries.
export const ACTIVITY_FILTER_CONFIGS: Record<string, FilterConfig> = {
  "Token:Transfer": { type: "or", attributes: ["from", "to"], excludeProtocolAddresses: ["from", "to"] },
  "YieldVault:Transfer": { type: "or", attributes: ["from", "to"], excludeProtocolAddresses: ["from", "to"] },
  "SaveUSDSTVault:Transfer": { type: "or", attributes: ["from", "to"], excludeProtocolAddresses: ["from", "to"] },
  "MercataBridge:DepositCompleted": { type: "single", attribute: "stratoRecipient" },
  "StratoNativeBridge:NativeDepositCompleted": { type: "single", attribute: "stratoRecipient" },
  "MercataBridge:WithdrawalRequested": { type: "single", attribute: "user" },
  "StratoNativeBridge:NativeWithdrawalRequested": { type: "single", attribute: "stratoSender" },
  "CDPEngine:USDSTMinted": { type: "single", attribute: "owner" },
  "Pool:Swap": { type: "single", attribute: "sender" },
  "Pool:AddLiquidity": { type: "single", attribute: "provider" },
  "Rewards:RewardsClaimed": { type: "single", attribute: "user" },
  "StratoStaking:Staked": { type: "single", attribute: "user" },
  "StratoStaking:StakeMoved": { type: "single", attribute: "user" },
  "StratoStaking:UnbondingStarted": { type: "single", attribute: "user" },
  "StratoStaking:UnbondedWithdrawn": { type: "single", attribute: "user" },
  "StratoStaking:DelegatorRewardsClaimed": { type: "single", attribute: "user" },
  "StratoStaking:SelfBonded": { type: "single", attribute: "operator" },
  "StratoStaking:SelfBondUnbondingStarted": { type: "single", attribute: "operator" },
  "StratoStaking:OperatorRewardsClaimed": { type: "single", attribute: "operator" },
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
