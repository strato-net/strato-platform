// Staking-facing surface of MercataGovernance (genesis address 0x100): the
// staking contract publishes validator stake weights and adds/removes the
// validators it manages.
interface IStakingGovernance {
    function addValidatorFromStaking(address validator, uint256 stake) external;
    function updateValidatorStake(address validator, uint256 stake) external;
    function removeValidatorFromStaking(address validator) external returns (bool);
    function validatorMap(address validator) external view returns (uint256);
    function stakingContract() external view returns (address);
    // Admin overrides of stake-weighted selection. Newer than some deployed
    // governance logic, so every call site reads them through a try/catch and
    // treats an older contract as "no override".
    function forcedInByAdmins(address validator) external view returns (bool);
    function forcedOutByAdmins(address validator) external view returns (bool);
}

// Genesis AdminRegistry (0x100c) vote surface: a whitelisted caller's
// castVoteOnIssue executes the target function immediately (the human vote
// quorum lives at the registry's admin layer).
interface IAdminRegistry {
    function castVoteOnIssue(address _target, string _func, variadic _args) external returns (bool, variadic);
}
