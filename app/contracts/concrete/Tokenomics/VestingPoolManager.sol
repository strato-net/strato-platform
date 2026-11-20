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
//   - everything else is a one-line forward with the pool's own names and parameters,
//     except one guard: a MANAGED grant must have a non-zero duration. Upstream's
//     cancelVesting releases a grant's whole amount when it is cancelled before its
//     start, but for a zero-week grant the vested-amount formula (elapsed 0 >= duration 0)
//     still reports the full amount after the start, so a later claim deducts it a
//     second time and pays it from tokens backing other vestings. A zero-week grant that
//     can be cancelled makes no sense anyway (it is a timelock); instant unlocks and the
//     treasury sweep are unmanaged. See VestingPoolSolidVM.test.sol for the upstream
//     behaviour and VestingPoolManager.test.sol for the guard.
//
// The manager holds no state of its own besides the immutable `pool`, and every
// owner-only body only forwards, so either the pool call succeeded in full or nothing
// changed. The owner is the AdminRegistry (decided 2026-11-02): an admin's call is a
// vote, and at quorum the registry calls back as owner. Verified on solid-vm-cli
// (tests/Tokenomics/VestingPoolManagerGovernance.test.sol): a pool rejection during
// that execution reverts the quorum vote's transaction WITH the pool's own message
// (e.g. "Not enough tokens available"), earlier votes stand, and one re-vote executes
// once the cause is fixed; a late vote on an executed issue opens a new issue and
// never re-executes; array arguments survive the vote path.
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
        require(!(managed && durationWeeks == 0), "VestingPoolManager: managed vesting needs a duration");
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
        require(!(managed && durationWeeks == 0), "VestingPoolManager: managed vesting needs a duration");
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
