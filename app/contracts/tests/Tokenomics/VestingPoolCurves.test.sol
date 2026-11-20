import "../../concrete/Tokenomics/VestingPool.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../Util.sol";

// Port of safe-token test/vesting/VestingPool.Cuves.spec.ts (main 886fc7b0).
// Adaptations: setNextBlockTime(absolute) becomes fastForward to the same offset from the
// vesting start; the AddedVesting event check becomes a totalTokensInVesting check.
contract Describe_VestingPoolCurves {
    uint constant STEP = 2629800; // D5: one monthly step, 365.25 days / 12
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

    function _warpTo(uint ts) internal {
        require(ts > block.timestamp, "warp target " + string(ts) + " is not after now " + string(block.timestamp));
        fastForward(ts - block.timestamp);
    }

    // upstream addVesting helper: fund, hash, add (event replaced by the total check)
    function _addVesting(uint8 curveType, uint16 durationWeeks, uint64 startDate, uint128 amount) internal returns (bytes32) {
        uint256 before = pool.totalTokensInVesting();
        strato.mint(address(pool), amount);
        bytes32 vestingHash = pool.vestingHash(address(user2), curveType, true, durationWeeks, startDate, amount);
        pool.addVesting(address(user2), curveType, true, durationWeeks, startDate, amount);
        require(pool.totalTokensInVesting() == before + amount, "vesting not added");
        return vestingHash;
    }

    function it_should_revert_if_vesting_not_found() public {
        user2.doExpectingFailure(address(pool), "calculateVestedAmount", "Vesting not found", keccak256(abi.encodePacked("test")));
    }

    // ---- linear: 200000 tokens over 104 weeks ----

    function _checkLinear(bytes32 vestingHash, uint progress) internal {
        (uint128 vestedAmount, ) = pool.calculateVestedAmount(vestingHash);
        uint256 expected = uint256(_units(200000)) * progress / 100;
        require(uint256(vestedAmount) == expected, "linear " + string(progress) + "%: vested " + string(vestedAmount) + " expected " + string(expected));
    }

    function _testLinear(uint progress) internal returns (bytes32 vestingHash, uint64 startDate) {
        startDate = uint64(block.timestamp);
        vestingHash = _addVesting(0, 104, startDate, _units(200000));
        if (progress > 0) {
            uint256 durationSeconds = 104 * WEEK;
            _warpTo(uint256(startDate) + durationSeconds * progress / 100);
            _checkLinear(vestingHash, progress);
        }
    }

    function it_linear_10_percent() public { _testLinear(10); }
    function it_linear_25_percent() public { _testLinear(25); }
    function it_linear_50_percent() public { _testLinear(50); }
    function it_linear_66_percent() public { _testLinear(66); }
    function it_linear_75_percent() public { _testLinear(75); }
    function it_linear_99_percent() public { _testLinear(99); }
    function it_linear_100_percent() public { _testLinear(100); }

    function it_linear_with_pauses() public {
        (bytes32 vestingHash, uint64 startDate) = _testLinear(0);
        pool.pauseVesting(vestingHash);

        // 2 weeks pause
        _warpTo(uint256(startDate) + 2 * WEEK);
        pool.unpauseVesting(vestingHash);
        _checkLinear(vestingHash, 0);

        _warpTo(uint256(startDate) + 28 * WEEK);
        pool.pauseVesting(vestingHash);
        _checkLinear(vestingHash, 25);

        // 4 weeks pause
        _warpTo(uint256(startDate) + 32 * WEEK);
        pool.unpauseVesting(vestingHash);
        _checkLinear(vestingHash, 25);

        _warpTo(uint256(startDate) + 84 * WEEK);
        _checkLinear(vestingHash, 75);

        _warpTo(uint256(startDate) + 200 * WEEK);
        _checkLinear(vestingHash, 100);
    }

    // ---- exponential: 660,000,000 tokens over 208 weeks ----

    function _checkExponential(bytes32 vestingHash, uint progress) internal {
        (uint128 vestedAmount, ) = pool.calculateVestedAmount(vestingHash);
        uint256 expected = uint256(_units(660000000)) * progress * progress / 10000;
        require(uint256(vestedAmount) == expected, "exponential " + string(progress) + "%: vested " + string(vestedAmount) + " expected " + string(expected));
    }

    function _testExponential(uint progress) internal returns (bytes32 vestingHash, uint64 startDate) {
        startDate = uint64(block.timestamp);
        vestingHash = _addVesting(1, 208, startDate, _units(660000000));
        if (progress > 0) {
            uint256 durationSeconds = 208 * WEEK;
            _warpTo(uint256(startDate) + durationSeconds * progress / 100);
            _checkExponential(vestingHash, progress);
        }
    }

    function it_exponential_10_percent() public { _testExponential(10); }
    function it_exponential_25_percent() public { _testExponential(25); }
    function it_exponential_50_percent() public { _testExponential(50); }
    function it_exponential_66_percent() public { _testExponential(66); }
    function it_exponential_75_percent() public { _testExponential(75); }
    function it_exponential_99_percent() public { _testExponential(99); }
    function it_exponential_100_percent() public { _testExponential(100); }

    function it_exponential_with_pauses() public {
        (bytes32 vestingHash, uint64 startDate) = _testExponential(0);
        pool.pauseVesting(vestingHash);

        // 3 weeks pause
        _warpTo(uint256(startDate) + 3 * WEEK);
        pool.unpauseVesting(vestingHash);
        _checkExponential(vestingHash, 0);

        _warpTo(uint256(startDate) + 55 * WEEK);
        pool.pauseVesting(vestingHash);
        _checkExponential(vestingHash, 25);

        // 9 weeks pause
        _warpTo(uint256(startDate) + 64 * WEEK);
        pool.unpauseVesting(vestingHash);
        _checkExponential(vestingHash, 25);

        _warpTo(uint256(startDate) + 168 * WEEK);
        _checkExponential(vestingHash, 75);

        _warpTo(uint256(startDate) + 500 * WEEK);
        _checkExponential(vestingHash, 100);
    }

    // ---- D5 monthly steps: 240,000 tokens over 24 steps ----

    function _checkSteps(bytes32 vestingHash, uint completed, uint steps, uint128 amount, string context) internal {
        (uint128 vestedAmount, ) = pool.calculateVestedAmount(vestingHash);
        uint256 expected = uint256(amount) * completed / steps;
        require(uint256(vestedAmount) == expected, context + ": vested " + string(vestedAmount) + " expected " + string(expected));
    }

    function it_steps_nothing_vests_before_the_first_boundary() public {
        uint64 startDate = uint64(block.timestamp);
        bytes32 id = _addVesting(2, 24, startDate, _units(240000));
        _checkSteps(id, 0, 24, _units(240000), "at start");
        _warpTo(uint256(startDate) + STEP - 1);
        _checkSteps(id, 0, 24, _units(240000), "one second before the first boundary");
        _warpTo(uint256(startDate) + STEP);
        _checkSteps(id, 1, 24, _units(240000), "first boundary");
    }

    function it_steps_vest_one_slice_per_boundary() public {
        uint64 startDate = uint64(block.timestamp);
        bytes32 id = _addVesting(2, 24, startDate, _units(240000));
        for (uint k = 1; k <= 24; k++) {
            _warpTo(uint256(startDate) + k * STEP);
            _checkSteps(id, k, 24, _units(240000), "boundary " + string(k));
        }
        _warpTo(uint256(startDate) + 100 * STEP);
        _checkSteps(id, 24, 24, _units(240000), "long after the end");
    }

    function it_steps_vest_nothing_between_boundaries() public {
        uint64 startDate = uint64(block.timestamp);
        bytes32 id = _addVesting(2, 24, startDate, _units(240000));
        _warpTo(uint256(startDate) + STEP + 1);
        _checkSteps(id, 1, 24, _units(240000), "one second after the first boundary");
        _warpTo(uint256(startDate) + 11 * STEP + STEP / 2);
        _checkSteps(id, 11, 24, _units(240000), "half way through the twelfth step");
        _warpTo(uint256(startDate) + 12 * STEP - 1);
        _checkSteps(id, 11, 24, _units(240000), "one second before the twelfth boundary");
        _warpTo(uint256(startDate) + 24 * STEP - 1);
        _checkSteps(id, 23, 24, _units(240000), "one second before the end");
        _warpTo(uint256(startDate) + 24 * STEP);
        _checkSteps(id, 24, 24, _units(240000), "the end");
    }

    function it_steps_pay_the_division_remainder_with_the_last_step() public {
        // 100 atoms over 3 steps: 33, 66, 100
        uint64 startDate = uint64(block.timestamp);
        bytes32 id = _addVesting(2, 3, startDate, 100);
        _warpTo(uint256(startDate) + STEP);
        (uint128 v1, ) = pool.calculateVestedAmount(id);
        require(v1 == 33, "step 1: " + string(v1));
        _warpTo(uint256(startDate) + 2 * STEP);
        (uint128 v2, ) = pool.calculateVestedAmount(id);
        require(v2 == 66, "step 2: " + string(v2));
        _warpTo(uint256(startDate) + 3 * STEP - 1);
        (uint128 v2b, ) = pool.calculateVestedAmount(id);
        require(v2b == 66, "before the last step: " + string(v2b));
        _warpTo(uint256(startDate) + 3 * STEP);
        (uint128 v3, ) = pool.calculateVestedAmount(id);
        require(v3 == 100, "last step: " + string(v3));
    }

    function it_steps_with_an_18_decimal_amount_over_36_steps() public {
        // 2500.5 tokens over 36 steps: every boundary is floor(amount * k / 36), never decreasing, complete at 36
        uint128 amount = uint128(25005 * 10**17);
        uint64 startDate = uint64(block.timestamp);
        bytes32 id = _addVesting(2, 36, startDate, amount);
        uint128 previous = 0;
        for (uint k = 1; k <= 36; k++) {
            _warpTo(uint256(startDate) + k * STEP);
            (uint128 v, ) = pool.calculateVestedAmount(id);
            require(uint256(v) == uint256(amount) * k / 36, "boundary " + string(k) + ": " + string(v));
            require(v >= previous, "vested decreased at boundary " + string(k));
            previous = v;
        }
        require(previous == amount, "everything vested at the last step");
    }

    function it_steps_zero_steps_vest_at_start() public {
        uint64 startDate = uint64(block.timestamp);
        bytes32 id = _addVesting(2, 0, startDate, _units(1000));
        (uint128 v, ) = pool.calculateVestedAmount(id);
        require(v == _units(1000), "zero-step vesting is a timelock: " + string(v));
    }

    function it_steps_first_slice_lands_one_step_after_a_cliff() public {
        // cliff = future start date: nothing at the cliff, the first slice one step later
        uint64 startDate = uint64(block.timestamp + 10 * STEP);
        bytes32 id = _addVesting(2, 12, startDate, _units(120000));
        user2.doExpectingFailure(address(pool), "calculateVestedAmount", "Vesting not active yet", id);
        _warpTo(uint256(startDate));
        _checkSteps(id, 0, 12, _units(120000), "at the cliff");
        _warpTo(uint256(startDate) + STEP - 1);
        _checkSteps(id, 0, 12, _units(120000), "just before the first slice");
        _warpTo(uint256(startDate) + STEP);
        _checkSteps(id, 1, 12, _units(120000), "one step after the cliff");
        _warpTo(uint256(startDate) + 12 * STEP);
        _checkSteps(id, 12, 12, _units(120000), "twelve steps after the cliff");
    }

    function it_steps_with_pauses() public {
        uint64 startDate = uint64(block.timestamp);
        bytes32 id = _addVesting(2, 24, startDate, _units(240000));
        // a one-step pause before the first boundary shifts the whole schedule by one step
        _warpTo(uint256(startDate) + STEP / 2);
        pool.pauseVesting(id);
        _warpTo(uint256(startDate) + STEP / 2 + STEP);
        pool.unpauseVesting(id);
        _checkSteps(id, 0, 24, _units(240000), "after a one-step pause");
        _warpTo(uint256(startDate) + 2 * STEP - 1);
        _checkSteps(id, 0, 24, _units(240000), "the first boundary moved by the pause");
        _warpTo(uint256(startDate) + 2 * STEP);
        _checkSteps(id, 1, 24, _units(240000), "first slice one step later");
        // a pause between boundaries freezes the completed steps
        _warpTo(uint256(startDate) + 6 * STEP + STEP / 2);
        pool.pauseVesting(id);
        _checkSteps(id, 5, 24, _units(240000), "frozen at five steps");
        _warpTo(uint256(startDate) + 9 * STEP);
        _checkSteps(id, 5, 24, _units(240000), "still five while paused");
        pool.unpauseVesting(id);
        _checkSteps(id, 5, 24, _units(240000), "still five right after unpausing");
        _warpTo(uint256(startDate) + 9 * STEP + STEP / 2);
        _checkSteps(id, 6, 24, _units(240000), "sixth slice half a step after unpausing");
        _warpTo(uint256(startDate) + 27 * STEP + STEP / 2 - 1);
        _checkSteps(id, 23, 24, _units(240000), "one second before the shifted end");
        _warpTo(uint256(startDate) + 27 * STEP + STEP / 2);
        _checkSteps(id, 24, 24, _units(240000), "complete at the shifted end");
    }
}
