import "../../concrete/Tokenomics/VestingPool.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../Util.sol";

// Port of safe-token test/vesting/VestingPool.Setup.spec.ts (main 886fc7b0).
// Adaptations: the harness has no events, so "emits AddedVesting" becomes a state check
// (totalTokensInVesting + the vesting being readable through calculateVestedAmount);
// block time is deterministic here, so the "after exactly 60 minutes" lower bounds that
// upstream satisfies only because Hardhat mines one second per transaction are replaced
// by the exact value at 3600 s (which lies inside upstream's [60 min, 61 min) window);
// upstream's Date.now() start dates become the harness clock.
contract Describe_VestingPoolSetup {
    uint constant WEEK = 604800;
    Token strato;
    User user2;
    VestingPool pool;

    function beforeAll() public {
        user2 = new User();
    }

    function beforeEach() public {
        TokenFactory factory = new TokenFactory(address(this));
        strato = Token(factory.createTokenWithInitialOwner("STRATO", "STRATO Token", new string[](0), new string[](0), new string[](0), "STRATO", 0, 18, address(this)));
        strato.setStatus(2);
        pool = new VestingPool(address(strato), address(this));
    }

    function _units(uint n) internal pure returns (uint128) {
        return uint128(n * 10**18);
    }

    function _now() internal view returns (uint64) {
        return uint64(block.timestamp);
    }

    // upstream: token.transfer(pool.address, amount)
    function _fund(uint128 amount) internal {
        strato.mint(address(pool), amount);
    }

    function it_should_revert_if_not_pool_manager() public {
        user2.doExpectingFailure(address(pool), "addVesting", "Can only be called by pool manager", address(user2), uint8(0), true, uint16(104), _now(), _units(200000));
    }

    function it_should_revert_if_no_balance_available() public {
        bool reverted = false;
        try pool.addVesting(address(user2), 0, true, 104, _now(), _units(200000)) { } catch Error(string e) { reverted = true; require(e == "Not enough tokens available", e); }
        require(reverted, "addVesting succeeded without balance");
    }

    function it_should_revert_with_invalid_vesting_curve() public {
        uint128 vestingAmount = _units(200000);
        _fund(vestingAmount);
        bool reverted = false;
        try pool.addVesting(address(user2), 2, true, 104, _now(), vestingAmount) { } catch Error(string e) { reverted = true; require(e == "Invalid vesting curve", e); }
        require(reverted, "invalid curve accepted");
    }

    function it_should_revert_if_vesting_is_added_for_zero_address() public {
        uint128 vestingAmount = _units(200000);
        _fund(vestingAmount);
        bool reverted = false;
        try pool.addVesting(address(0), 0, true, 104, _now(), vestingAmount) { } catch Error(string e) { reverted = true; require(e == "Invalid account", e); }
        require(reverted, "zero address accepted");
    }

    function it_should_revert_if_same_vesting_is_added_twice() public {
        uint128 vestingAmount = _units(200000);
        uint64 targetTime = _now() + 3600;
        _fund(vestingAmount);
        pool.addVesting(address(user2), 0, true, 104, targetTime, vestingAmount);
        bool reverted = false;
        try pool.addVesting(address(user2), 0, true, 104, targetTime, vestingAmount) { } catch Error(string e) { reverted = true; require(e == "Vesting id already used", e); }
        require(reverted, "duplicate vesting accepted");
    }

    function it_can_add_linear_vesting_that_starts_in_the_future() public {
        uint128 vestingAmount = _units(200000);
        uint64 targetTime = _now() + 3600;
        _fund(vestingAmount);
        bytes32 vestingHash = pool.vestingHash(address(user2), 0, true, 104, targetTime, vestingAmount);
        pool.addVesting(address(user2), 0, true, 104, targetTime, vestingAmount);
        require(pool.totalTokensInVesting() == vestingAmount, "vesting not registered");
        user2.doExpectingFailure(address(pool), "calculateVestedAmount", "Vesting not active yet", vestingHash);
    }

    function it_can_add_linear_vesting_that_starts_in_the_past() public {
        fastForward(7200);
        uint128 vestingAmount = _units(200000);
        uint64 targetTime = _now() - 3600;
        _fund(vestingAmount);
        bytes32 vestingHash = pool.vestingHash(address(user2), 0, true, 104, targetTime, vestingAmount);
        pool.addVesting(address(user2), 0, true, 104, targetTime, vestingAmount);
        (uint128 vestedAmount, ) = pool.calculateVestedAmount(vestingHash);
        // Exactly 60 minutes elapsed: 200000e18 * 3600 / (104 weeks)
        require(uint256(vestedAmount) == 11446886446886446886, "vested after 60 min: " + string(vestedAmount));
        // Expected value after exactly 61 minutes (upstream upper bound)
        require(uint256(vestedAmount) < 11637667887700000000, "vested exceeds the 61 min bound");
        require(pool.totalTokensInVesting() == vestingAmount, "total in vesting");
    }

    function it_can_add_exponential_vesting_that_starts_in_the_future() public {
        uint128 vestingAmount = _units(400000);
        uint64 targetTime = _now() + 3600;
        _fund(vestingAmount);
        bytes32 vestingHash = pool.vestingHash(address(user2), 1, true, 104, targetTime, vestingAmount);
        pool.addVesting(address(user2), 1, true, 104, targetTime, vestingAmount);
        require(pool.totalTokensInVesting() == vestingAmount, "vesting not registered");
        user2.doExpectingFailure(address(pool), "calculateVestedAmount", "Vesting not active yet", vestingHash);
    }

    function it_can_add_exponential_vesting_that_starts_in_the_past() public {
        fastForward(7200);
        uint128 vestingAmount = _units(400000);
        uint64 targetTime = _now() - 3600;
        _fund(vestingAmount);
        bytes32 vestingHash = pool.vestingHash(address(user2), 1, true, 208, targetTime, vestingAmount);
        pool.addVesting(address(user2), 1, true, 208, targetTime, vestingAmount);
        (uint128 vestedAmount, ) = pool.calculateVestedAmount(vestingHash);
        // Exactly 60 minutes elapsed: 400000e18 * 3600^2 / (208 weeks)^2
        uint256 duration = 208 * WEEK;
        uint256 expected = uint256(vestingAmount) * 3600 * 3600 / (duration * duration);
        require(uint256(vestedAmount) == expected, "vested after 60 min: " + string(vestedAmount));
        // upstream window: >= 0.00032757802e18 (after 60 min) and < 0.00033858828e18 (after 61 min)
        require(uint256(vestedAmount) >= 327578020000000, "below the 60 min bound");
        require(uint256(vestedAmount) < 338588280000000, "above the 61 min bound");
        require(pool.totalTokensInVesting() == vestingAmount, "total in vesting");
    }

    function it_can_add_multiple_vestings_for_same_user() public {
        fastForward(7200);
        uint128 vestingAmount1 = _units(400000);
        uint64 currentTime = _now();
        uint64 targetTime = currentTime - 3600;

        // Transfer tokens for first vesting
        _fund(vestingAmount1 + _units(100000));
        // Add first vesting
        bytes32 vestingHash1 = pool.vestingHash(address(user2), 1, true, 208, targetTime, vestingAmount1);
        pool.addVesting(address(user2), 1, true, 208, targetTime, vestingAmount1);

        // Check pool state
        require(pool.totalTokensInVesting() == vestingAmount1, "total after first");
        // Check first vesting
        (uint128 vestedAmount1, ) = pool.calculateVestedAmount(vestingHash1);
        require(uint256(vestedAmount1) >= 327578020000000, "first below the 60 min bound");
        require(uint256(vestedAmount1) < 338588280000000, "first above the 61 min bound");

        // Try to add second vesting
        uint128 vestingAmount2 = _units(200000);
        bool reverted = false;
        try pool.addVesting(address(user2), 0, true, 104, currentTime, vestingAmount2) { } catch Error(string e) { reverted = true; require(e == "Not enough tokens available", e); }
        require(reverted, "second vesting accepted without balance");

        // Transfer tokens for second vesting
        _fund(vestingAmount1);
        // Add second vesting
        bytes32 vestingHash2 = pool.vestingHash(address(user2), 0, true, 104, targetTime, vestingAmount2);
        pool.addVesting(address(user2), 0, true, 104, targetTime, vestingAmount2);

        // Check pool state
        require(pool.totalTokensInVesting() == vestingAmount1 + vestingAmount2, "total after second");
        // Check second vesting
        (uint128 vestedAmount2, ) = pool.calculateVestedAmount(vestingHash2);
        require(uint256(vestedAmount2) == 11446886446886446886, "second vested after 60 min: " + string(vestedAmount2));
        require(uint256(vestedAmount2) < 11637667887700000000, "second exceeds the 61 min bound");
    }
}
