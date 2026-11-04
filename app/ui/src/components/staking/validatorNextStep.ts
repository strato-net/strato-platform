// What a validator's operator has to do next, from the same on-chain facts the status badge uses.
// status: 0 Missing, 1 Registered (listed, not in the set), 2 Active, 3 Kicked (delisted).
export type ValidatorNextStepInput = {
  status: 0 | 1 | 2 | 3;
  isValidator: boolean;
  isWaiter?: boolean;
  selfBond: string;
  // Fresh readiness evidence: an acknowledgement from the validator key within the day.
  isReady?: boolean;
};

export const describeValidatorNextStep = (
  validator: ValidatorNextStepInput,
  minStake: string,
  minStakeLabel: string,
  symbol: string,
  joinsOpen: boolean
): string | null => {
  if (validator.status === 3) return "This validator is delisted. Relisting needs an admin vote.";
  if (validator.isValidator) return "In the validator set.";
  if (BigInt(validator.selfBond || "0") < BigInt(minStake || "0")) {
    return `Self-bond at least ${minStakeLabel} ${symbol} to become eligible.`;
  }
  if (!validator.isReady) {
    return "Eligible. The node must send a readiness acknowledgement from its validator key (good for a day) before it can join.";
  }
  if (validator.isWaiter) return joinsOpen ? "Ready. Activate to join the validator set." : "Ready. Admission opens at the agreed block.";
  return null;
};
