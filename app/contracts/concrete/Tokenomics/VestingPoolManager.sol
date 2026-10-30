import "./VestingPool.sol";
import "../../abstract/ERC20/access/Ownable.sol";

// VestingPoolManager: the STRATO-side manager of an audited Safe VestingPool.
//
// VestingPool (ported byte for byte, see its header) checks its manager with a plain
// `require(msg.sender == poolManager)` on an immutable address, offers no batch
// creation, and cannot rotate the manager. STRATO's governance is AdminRegistry, which
// only reaches a contract through the repo Ownable. Rather than edit the audited file,
// this contract deploys the pool in its constructor so that it IS the pool's immutable
// manager, and exposes the manager calls behind the repo Ownable:
//   - governance: `owner()` is whoever the platform wants (AdminRegistry, a multisig
//     contract, or a key), and `transferOwnership` rotates control of the pool;
//   - batch creation: `addVestings` creates one category's vestings in one call;
//   - everything else is a one-line forward with the pool's own names and parameters.
//
// The manager holds no state of its own besides the immutable `pool`, and every
// owner-only body only forwards, so the repo Ownable's behaviour of catching a failing
// body (and routing it into AdminRegistry.castVoteOnIssue) can never leave partial
// state here: either the pool call succeeded in full or nothing changed. Operators
// should still verify pool state after each admin action (section "Ownable" of the
// handoff), because a failed forward does not surface the pool's revert message.
//
// Beneficiaries never touch this contract: they call `claimVestedTokens` on the pool.
contract record VestingPoolManager is Ownable {
    VestingPool public immutable pool;

    constructor(address token_, address initialOwner) Ownable(initialOwner) {
        pool = new VestingPool(token_, address(this));
    }

    /// @notice The ERC-20 vested by the pool.
    function token() external view returns (address) {
        return pool.token();
    }

    /// @notice Forward of VestingPool.addVesting (same parameters, same order).
    function addVesting(
        address account,
        uint8 curveType,
        bool managed,
        uint16 durationWeeks,
        uint64 startDate,
        uint128 amount
    ) external onlyOwner {
        pool.addVesting(account, curveType, managed, durationWeeks, startDate, amount);
    }

    /// @notice Create one linear vesting per account, all with the same shape.
    /// @dev One tokenomics category per call: same managed flag, duration and start.
    function addVestings(
        address[] accounts,
        uint128[] amounts,
        bool managed,
        uint16 durationWeeks,
        uint64 startDate
    ) external onlyOwner {
        require(accounts.length > 0, "VestingPoolManager: empty batch");
        require(accounts.length == amounts.length, "VestingPoolManager: length mismatch");
        for (uint256 i = 0; i < accounts.length; i++) {
            pool.addVesting(accounts[i], 0, managed, durationWeeks, startDate, amounts[i]);
        }
    }

    /// @notice Forward of VestingPool.cancelVesting (managed vestings only).
    function cancelVesting(bytes32 vestingId) external onlyOwner {
        pool.cancelVesting(vestingId);
    }

    /// @notice Forward of VestingPool.pauseVesting (managed vestings only).
    function pauseVesting(bytes32 vestingId) external onlyOwner {
        pool.pauseVesting(vestingId);
    }

    /// @notice Forward of VestingPool.unpauseVesting.
    function unpauseVesting(bytes32 vestingId) external onlyOwner {
        pool.unpauseVesting(vestingId);
    }
}
