import "../../concrete/Tokenomics/VestingPool.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../Util.sol";

// Port of safe-token test/vesting/VestingPool.Manage.spec.ts (main 886fc7b0).
// Adaptations: the public `vestings(id)` getter returns empty values on this CLI, so the
// pool under test is InspectablePool, a subclass that only adds field readers (logic is the
// inherited upstream code); Paused/Unpaused/CancelledVesting events become state checks;
// setNextBlockTime becomes fastForward; "last block time" is the deterministic harness clock.
contract InspectablePool is VestingPool {
    constructor(address t, address m) VestingPool(t, m) {}
    function vestingStartDate(bytes32 id) external view returns (uint64) { return vestings[id].startDate; }
    function vestingPausingDate(bytes32 id) external view returns (uint64) { return vestings[id].pausingDate; }
    function vestingCancelled(bytes32 id) external view returns (bool) { return vestings[id].cancelled; }
}

contract Describe_VestingPoolManage {
    uint constant WEEK = 604800;
    Token strato;
    User user2;
    InspectablePool pool;

    function beforeAll() public {
        user2 = new User();
    }

    function beforeEach() public {
        TokenFactory factory = new TokenFactory(address(this));
        strato = Token(factory.createTokenWithInitialOwner("STRATO", "STRATO Token", new string[](0), new string[](0), new string[](0), "STRATO", 0, 18, address(this)));
        strato.setStatus(2);
        pool = new InspectablePool(address(strato), address(this));
    }

    function _units(uint n) internal pure returns (uint128) {
        return uint128(n * 10**18);
    }

    function _now() internal view returns (uint64) {
        return uint64(block.timestamp);
    }

    function _warpTo(uint ts) internal {
        require(ts > block.timestamp, "warp target " + string(ts) + " is not after now " + string(block.timestamp));
        fastForward(ts - block.timestamp);
    }

    function _randomId() internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("test"));
    }

    // upstream helper: vesting for user2, linear, 104 weeks
    function _addVesting(uint128 amount, uint64 startTime, bool managed) internal returns (bytes32) {
        strato.mint(address(pool), amount);
        bytes32 vestingHash = pool.vestingHash(address(user2), 0, managed, 104, startTime, amount);
        pool.addVesting(address(user2), 0, managed, 104, startTime, amount);
        return vestingHash;
    }

    // ---- pauseVesting ----

    function it_pause_should_revert_if_not_pool_manager() public {
        user2.doExpectingFailure(address(pool), "pauseVesting", "Can only be called by pool manager", _randomId());
    }

    function it_pause_should_revert_if_vesting_not_found() public {
        bool reverted = false;
        try pool.pauseVesting(_randomId()) { } catch Error(string e) { reverted = true; require(e == "Vesting not found", e); }
        require(reverted, "pause of unknown vesting succeeded");
    }

    function it_pause_should_revert_if_vesting_is_not_managed() public {
        bytes32 vestingHash = _addVesting(_units(200000), _now() + 3600, false);
        bool reverted = false;
        try pool.pauseVesting(vestingHash) { } catch Error(string e) { reverted = true; require(e == "Only managed vestings can be paused", e); }
        require(reverted, "unmanaged vesting paused");
    }

    function it_pause_vesting_that_starts_in_the_future() public {
        bytes32 vestingHash = _addVesting(_units(200000), _now() + 3600, true);
        pool.pauseVesting(vestingHash);
        // If vesting that starts in the future is paused then the pausing date is the start date
        require(pool.vestingPausingDate(vestingHash) == pool.vestingStartDate(vestingHash), "pausing date must equal start date");
    }

    function it_pause_vesting_that_started_in_the_past() public {
        fastForward(7200);
        bytes32 vestingHash = _addVesting(_units(200000), _now() - 3600, true);
        pool.pauseVesting(vestingHash);
        require(pool.vestingPausingDate(vestingHash) == _now(), "pausing date must be the block time");
    }

    function it_should_revert_if_vesting_is_paused_twice() public {
        bytes32 vestingHash = _addVesting(_units(200000), _now() + 3600, true);
        pool.pauseVesting(vestingHash);
        require(pool.vestingPausingDate(vestingHash) != 0, "first pause not recorded");
        bool reverted = false;
        try pool.pauseVesting(vestingHash) { } catch Error(string e) { reverted = true; require(e == "Vesting already paused", e); }
        require(reverted, "second pause succeeded");
    }

    // ---- unpauseVesting ----

    function it_unpause_should_revert_if_not_pool_manager() public {
        user2.doExpectingFailure(address(pool), "unpauseVesting", "Can only be called by pool manager", _randomId());
    }

    function it_unpause_should_revert_if_vesting_not_found() public {
        bool reverted = false;
        try pool.unpauseVesting(_randomId()) { } catch Error(string e) { reverted = true; require(e == "Vesting not found", e); }
        require(reverted, "unpause of unknown vesting succeeded");
    }

    function it_should_revert_if_vesting_is_not_paused() public {
        bytes32 vestingHash = _addVesting(_units(200000), _now() + 3600, true);
        bool reverted = false;
        try pool.unpauseVesting(vestingHash) { } catch Error(string e) { reverted = true; require(e == "Vesting is not paused", e); }
        require(reverted, "unpause of running vesting succeeded");
    }

    function it_unpause_vesting_that_starts_in_the_future() public {
        bytes32 vestingHash = _addVesting(_units(200000), _now() + 3600, true);
        uint64 startingDate = pool.vestingStartDate(vestingHash);
        require(pool.vestingPausingDate(vestingHash) == 0, "not paused initially");

        pool.pauseVesting(vestingHash);
        require(pool.vestingPausingDate(vestingHash) == startingDate, "pausing date is the start date");

        pool.unpauseVesting(vestingHash);
        require(pool.vestingPausingDate(vestingHash) == 0, "pausing date cleared");
        // Starting date should not be adjusted for vestings in the future
        require(pool.vestingStartDate(vestingHash) == startingDate, "start date unchanged");
    }

    function it_unpause_vesting_that_starts_in_the_future_after_it_started() public {
        uint64 targetTime = _now() + 3600;
        bytes32 vestingHash = _addVesting(_units(200000), targetTime, true);
        require(pool.vestingPausingDate(vestingHash) == 0, "not paused initially");

        pool.pauseVesting(vestingHash);
        require(pool.vestingPausingDate(vestingHash) == pool.vestingStartDate(vestingHash), "pausing date is the start date");

        _warpTo(uint256(targetTime) + 400);
        pool.unpauseVesting(vestingHash);
        require(pool.vestingPausingDate(vestingHash) == 0, "pausing date cleared");
        require(pool.vestingStartDate(vestingHash) == targetTime + 400, "start date moved by the paused time: " + string(pool.vestingStartDate(vestingHash)));
    }

    function it_unpause_vesting_that_started_in_the_past() public {
        fastForward(7200);
        uint64 targetTime = _now() - 3600;
        bytes32 vestingHash = _addVesting(_units(200000), targetTime, true);
        require(pool.vestingPausingDate(vestingHash) == 0, "not paused initially");

        _warpTo(uint256(targetTime) + 4000);
        pool.pauseVesting(vestingHash);
        require(pool.vestingPausingDate(vestingHash) == targetTime + 4000, "pausing date is the pause time");

        _warpTo(uint256(targetTime) + 14000);
        pool.unpauseVesting(vestingHash);
        require(pool.vestingPausingDate(vestingHash) == 0, "pausing date cleared");
        require(pool.vestingStartDate(vestingHash) == targetTime + 10000, "start date moved by 10000: " + string(pool.vestingStartDate(vestingHash)));
    }

    // ---- cancelVesting ----

    function it_cancel_should_revert_if_not_pool_manager() public {
        user2.doExpectingFailure(address(pool), "cancelVesting", "Can only be called by pool manager", _randomId());
    }

    function it_cancel_should_revert_if_vesting_not_found() public {
        bool reverted = false;
        try pool.cancelVesting(_randomId()) { } catch Error(string e) { reverted = true; require(e == "Vesting not found", e); }
        require(reverted, "cancel of unknown vesting succeeded");
    }

    function it_cancel_vesting_that_starts_in_the_future() public {
        uint128 vestingAmount = _units(200000);
        bytes32 vestingHash = _addVesting(vestingAmount, _now() + 3600, true);
        require(pool.vestingPausingDate(vestingHash) == 0, "not paused initially");
        require(!pool.vestingCancelled(vestingHash), "not cancelled initially");
        require(pool.totalTokensInVesting() == vestingAmount, "total before cancel");

        pool.cancelVesting(vestingHash);

        // If vesting that starts in the future is cancelled then the pausing date is the start date
        require(pool.vestingPausingDate(vestingHash) == pool.vestingStartDate(vestingHash), "pausing date is the start date");
        require(pool.vestingCancelled(vestingHash), "cancelled");
        require(pool.totalTokensInVesting() == 0, "everything returned to the pool");
    }

    function it_cancel_paused_vesting() public {
        uint128 vestingAmount = _units(200000);
        uint64 targetTime = _now() + 3600;
        bytes32 vestingHash = _addVesting(vestingAmount, targetTime, true);
        require(pool.vestingPausingDate(vestingHash) == 0, "not paused initially");
        require(!pool.vestingCancelled(vestingHash), "not cancelled initially");
        require(pool.totalTokensInVesting() == vestingAmount, "total before pause");

        _warpTo(uint256(targetTime) + 3600);
        pool.pauseVesting(vestingHash);

        // Check paused vesting state
        require(pool.vestingPausingDate(vestingHash) == targetTime + 3600, "pausing date");
        require(!pool.vestingCancelled(vestingHash), "not cancelled by pause");
        require(pool.totalTokensInVesting() == vestingAmount, "total unchanged by pause");

        _warpTo(uint256(targetTime) + 7200);
        pool.cancelVesting(vestingHash);

        // Check cancelled vesting state: 200000e18 * 3600 / (104 weeks)
        uint256 expectedAmount = 11446886446886446886;
        (uint128 vestedAmount, ) = pool.calculateVestedAmount(vestingHash);
        require(uint256(vestedAmount) == expectedAmount, "vested frozen at the pause: " + string(vestedAmount));
        // Pausing date should not be adjusted if vesting was already paused
        require(pool.vestingPausingDate(vestingHash) == targetTime + 3600, "pausing date kept");
        require(pool.vestingCancelled(vestingHash), "cancelled");
        require(pool.totalTokensInVesting() == expectedAmount, "only the vested part stays committed");
    }

    function it_cancel_vesting_with_vested_tokens() public {
        uint128 vestingAmount = _units(200000);
        uint64 targetTime = _now() + 3600;
        bytes32 vestingHash = _addVesting(vestingAmount, targetTime, true);
        require(pool.vestingPausingDate(vestingHash) == 0, "not paused initially");
        require(!pool.vestingCancelled(vestingHash), "not cancelled initially");
        require(pool.totalTokensInVesting() == vestingAmount, "total before cancel");

        _warpTo(uint256(targetTime) + 3600);
        pool.cancelVesting(vestingHash);

        uint256 expectedAmount = 11446886446886446886;
        (uint128 vestedAmount, ) = pool.calculateVestedAmount(vestingHash);
        require(uint256(vestedAmount) == expectedAmount, "vested at cancel: " + string(vestedAmount));
        require(pool.vestingPausingDate(vestingHash) == targetTime + 3600, "pausing date is the cancel time");
        require(pool.vestingCancelled(vestingHash), "cancelled");
        require(pool.totalTokensInVesting() == expectedAmount, "only the vested part stays committed");
    }

    function it_cancel_should_revert_if_vesting_is_not_managed() public {
        bytes32 vestingHash = _addVesting(_units(200000), _now() + 3600, false);
        bool reverted = false;
        try pool.cancelVesting(vestingHash) { } catch Error(string e) { reverted = true; require(e == "Only managed vestings can be cancelled", e); }
        require(reverted, "unmanaged vesting cancelled");
    }

    function it_should_revert_if_vesting_is_cancelled_twice() public {
        bytes32 vestingHash = _addVesting(_units(200000), _now() + 3600, true);
        pool.cancelVesting(vestingHash);
        bool reverted = false;
        try pool.cancelVesting(vestingHash) { } catch Error(string e) { reverted = true; require(e == "Vesting already cancelled", e); }
        require(reverted, "second cancel succeeded");
    }

    function it_should_revert_if_cancelled_vesting_is_unpaused() public {
        uint128 vestingAmount = _units(200000);
        uint64 targetTime = _now() + 3600;
        bytes32 vestingHash = _addVesting(vestingAmount, targetTime, true);
        require(pool.vestingPausingDate(vestingHash) == 0, "not paused initially");
        require(!pool.vestingCancelled(vestingHash), "not cancelled initially");
        require(pool.totalTokensInVesting() == vestingAmount, "total before cancel");

        _warpTo(uint256(targetTime) + 3600);
        pool.cancelVesting(vestingHash);
        require(pool.vestingPausingDate(vestingHash) == targetTime + 3600, "pausing date is the cancel time");
        require(pool.vestingCancelled(vestingHash), "cancelled");

        bool reverted = false;
        try pool.unpauseVesting(vestingHash) { } catch Error(string e) { reverted = true; require(e == "Vesting has been cancelled and cannot be unpaused", e); }
        require(reverted, "cancelled vesting unpaused");
    }
}
