import "../../concrete/Tokenomics/VestingPool.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../Util.sol";

// Port of safe-token test/vesting/VestingPool.Cuves.spec.ts (main 886fc7b0).
// Adaptations: setNextBlockTime(absolute) becomes fastForward to the same offset from the
// vesting start; the AddedVesting event check becomes a totalTokensInVesting check.
contract Describe_VestingPoolCurves {
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
}
