// Staking-facing surface of MercataGovernance (genesis address 0x100): the
// staking contract publishes validator stake weights and adds/removes the
// validators it manages.
interface IStakingGovernance {
    function addValidatorFromStaking(address validator, uint256 stake) external;
    function updateValidatorStake(address validator, uint256 stake) external;
    function removeValidatorFromStaking(address validator) external returns (bool);
    function validatorMap(address validator) external view returns (uint256);
    function stakingContract() external view returns (address);
}
