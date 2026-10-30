import "../../concrete/Tokenomics/VestingPool.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../Util.sol";

// SolidVM-specific probes against the untouched upstream logic. BatchPool checks that a
// derived contract can reach the inherited internal creator and the hash (with its
// private constants) on this CLI; it is a test fixture, not the production manager.
contract BatchPool is VestingPool {
    constructor(address t, address m) VestingPool(t, m) {}
    function addTwo(address a1, uint128 x1, address a2, uint128 x2, uint16 durationWeeks, uint64 startDate, bool managed) external onlyPoolManager {
        _addVesting(a1, 0, managed, durationWeeks, startDate, x1);
        _addVesting(a2, 0, managed, durationWeeks, startDate, x2);
    }
}

contract Describe_VestingPoolSolidVM {
    uint constant WEEK = 604800;
    Token strato;
    User alice;
    User bob;
    VestingPool pool;

    function beforeAll() public {
        alice = new User();
        bob = new User();
    }

    function beforeEach() public {
        TokenFactory factory = new TokenFactory(address(this));
        strato = Token(factory.createTokenWithInitialOwner("STRATO", "STRATO Token", new string[](0), new string[](0), new string[](0), "STRATO", 0, 18, address(this)));
        strato.setStatus(2);
        pool = new VestingPool(address(strato), address(this));
        strato.mint(address(pool), 10000);
    }

    function it_hashes_ids_and_creates_managed_and_unmanaged_vestings() public {
        uint64 start = uint64(block.timestamp);
        bytes32 aliceId = pool.vestingHash(address(alice), 0, true, 104, start, 2400);
        bytes32 bobId = pool.vestingHash(address(bob), 0, false, 104, start, 2400);
        require(aliceId != bobId, "ids must differ");
        pool.addVesting(address(alice), 0, true, 104, start, 2400);
        pool.addVesting(address(bob), 0, false, 104, start, 2400);
        require(pool.totalTokensInVesting() == 4800, "committed " + string(pool.totalTokensInVesting()));
        require(pool.tokensAvailableForVesting() == 5200, "available " + string(pool.tokensAvailableForVesting()));
        // duplicate id is rejected
        bool reverted = false;
        try pool.addVesting(address(alice), 0, true, 104, start, 2400) { } catch Error(string e) { reverted = true; require(e == "Vesting id already used", e); }
        require(reverted, "duplicate accepted");
    }

    function it_claims_linearly_with_the_max_sentinel_and_explicit_amounts() public {
        uint64 start = uint64(block.timestamp);
        pool.addVesting(address(alice), 0, true, 104, start, 2400);
        bytes32 id = pool.vestingHash(address(alice), 0, true, 104, start, 2400);
        fastForward(52 * WEEK);
        (uint128 vested, uint128 claimed) = pool.calculateVestedAmount(id);
        require(vested == 1200 && claimed == 0, "half way: vested " + string(vested) + " claimed " + string(claimed));
        // claim all with the sentinel
        alice.do(address(pool), "claimVestedTokens", id, address(alice), uint128(340282366920938463463374607431768211455));
        require(strato.balanceOf(address(alice)) == 1200, "alice balance " + string(strato.balanceOf(address(alice))));
        (uint128 vested2, uint128 claimed2) = pool.calculateVestedAmount(id);
        require(claimed2 == 1200, "claimed recorded " + string(claimed2));
        require(pool.totalTokensInVesting() == 1200, "committed after claim " + string(pool.totalTokensInVesting()));
        // explicit amount, then over-claim rejected, then stranger rejected
        fastForward(26 * WEEK);
        alice.do(address(pool), "claimVestedTokens", id, address(alice), uint128(100));
        require(strato.balanceOf(address(alice)) == 1300, "alice after explicit " + string(strato.balanceOf(address(alice))));
        alice.doExpectingFailure(address(pool), "claimVestedTokens", "Trying to claim too many tokens", id, address(alice), uint128(10000));
        bob.doExpectingFailure(address(pool), "claimVestedTokens", "Can only be claimed by vesting owner", id, address(bob), uint128(1));
        // at the end everything is claimable
        fastForward(30 * WEEK);
        alice.do(address(pool), "claimVestedTokens", id, address(alice), uint128(340282366920938463463374607431768211455));
        require(strato.balanceOf(address(alice)) == 2400, "alice at end " + string(strato.balanceOf(address(alice))));
        require(pool.totalTokensInVesting() == 0, "nothing left committed");
    }

    function it_cancels_only_managed_vestings_and_freezes_the_vested_part() public {
        uint64 start = uint64(block.timestamp);
        pool.addVesting(address(alice), 0, true, 104, start, 2400);
        pool.addVesting(address(bob), 0, false, 104, start, 2400);
        bytes32 aliceId = pool.vestingHash(address(alice), 0, true, 104, start, 2400);
        bytes32 bobId = pool.vestingHash(address(bob), 0, false, 104, start, 2400);
        fastForward(26 * WEEK);
        bool reverted = false;
        try pool.cancelVesting(bobId) { } catch Error(string e) { reverted = true; require(e == "Only managed vestings can be cancelled", e); }
        require(reverted, "unmanaged vesting was cancelled");
        pool.cancelVesting(aliceId);
        // 600 vested at cancel stays claimable; 1800 returns to the pool
        require(pool.totalTokensInVesting() == 2400 + 600, "committed after cancel " + string(pool.totalTokensInVesting()));
        require(pool.tokensAvailableForVesting() == 10000 - 3000, "available after cancel " + string(pool.tokensAvailableForVesting()));
        fastForward(52 * WEEK);
        (uint128 vested, ) = pool.calculateVestedAmount(aliceId);
        require(vested == 600, "frozen at " + string(vested));
        alice.do(address(pool), "claimVestedTokens", aliceId, address(alice), uint128(340282366920938463463374607431768211455));
        require(strato.balanceOf(address(alice)) == 600, "alice gets exactly the frozen part");
        reverted = false;
        try pool.unpauseVesting(aliceId) { } catch Error(string e) { reverted = true; require(e == "Vesting has been cancelled and cannot be unpaused", e); }
        require(reverted, "cancelled vesting was unpaused");
    }

    function it_pauses_without_accrual_and_resumes_with_an_offset_start() public {
        uint64 start = uint64(block.timestamp);
        pool.addVesting(address(alice), 0, true, 104, start, 2400);
        bytes32 id = pool.vestingHash(address(alice), 0, true, 104, start, 2400);
        fastForward(26 * WEEK);
        pool.pauseVesting(id);
        fastForward(26 * WEEK);
        (uint128 vested, ) = pool.calculateVestedAmount(id);
        require(vested == 600, "accrued while paused: " + string(vested));
        pool.unpauseVesting(id);
        fastForward(26 * WEEK);
        (uint128 vestedAfter, ) = pool.calculateVestedAmount(id);
        require(vestedAfter == 1200, "after resume: " + string(vestedAfter));
    }

    function it_withdraws_clawed_back_tokens_via_a_zero_week_vesting() public {
        uint64 start = uint64(block.timestamp);
        pool.addVesting(address(this), 0, false, 0, start, 5000);
        bytes32 id = pool.vestingHash(address(this), 0, false, 0, start, 5000);
        (uint128 vested, ) = pool.calculateVestedAmount(id);
        require(vested == 5000, "zero-week vesting not fully vested: " + string(vested));
        pool.claimVestedTokens(id, address(this), uint128(340282366920938463463374607431768211455));
        require(strato.balanceOf(address(this)) == 5000, "treasury received " + string(strato.balanceOf(address(this))));
    }

    function it_supports_a_batch_subclass() public {
        BatchPool batch = new BatchPool(address(strato), address(this));
        strato.mint(address(batch), 1000);
        uint64 start = uint64(block.timestamp);
        batch.addTwo(address(alice), 400, address(bob), 600, 104, start, false);
        require(batch.totalTokensInVesting() == 1000, "batch committed " + string(batch.totalTokensInVesting()));
        bytes32 bobId = batch.vestingHash(address(bob), 0, false, 104, start, 600);
        (uint128 vested, uint128 claimed) = batch.calculateVestedAmount(bobId);
        require(vested == 0 && claimed == 0, "fresh batch vesting");
    }
}
