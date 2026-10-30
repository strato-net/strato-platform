import "../../concrete/Tokenomics/VestingPoolManager.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../Util.sol";

// The manager owns the pool (it is the pool's immutable poolManager) and exposes the
// manager calls behind the repo Ownable. Owner-side failures are caught by that Ownable
// and routed into AdminRegistry.castVoteOnIssue on the owner; with this test contract
// as owner that surfaces as a generic revert, so those cases assert state, not messages.
contract Describe_VestingPoolManager {
    uint constant WEEK = 604800;
    uint128 constant MAX128 = 340282366920938463463374607431768211455;
    Token strato;
    User alice;
    User bob;
    User carol;
    VestingPoolManager manager;
    VestingPool pool;

    function beforeAll() public {
        alice = new User();
        bob = new User();
        carol = new User();
    }

    function beforeEach() public {
        TokenFactory factory = new TokenFactory(address(this));
        strato = Token(factory.createTokenWithInitialOwner("STRATO", "STRATO Token", new string[](0), new string[](0), new string[](0), "STRATO", 0, 18, address(this)));
        strato.setStatus(2);
        manager = new VestingPoolManager(address(strato), address(this));
        pool = manager.pool();
        strato.mint(address(pool), 10000);
    }

    function it_wires_the_pool_to_the_manager() public {
        require(pool.poolManager() == address(manager), "pool manager is not the manager contract");
        require(pool.token() == address(strato), "pool token");
        require(manager.token() == address(strato), "manager token view");
        require(manager.owner() == address(this), "manager owner");
        require(pool.tokensAvailableForVesting() == 10000, "funded pool");
    }

    function it_forwards_addVesting_from_the_owner() public {
        uint64 start = uint64(block.timestamp);
        manager.addVesting(address(alice), 0, true, 104, start, 2400);
        require(pool.totalTokensInVesting() == 2400, "committed " + string(pool.totalTokensInVesting()));
        bytes32 id = pool.vestingHash(address(alice), 0, true, 104, start, 2400);
        (uint128 vested, uint128 claimed) = pool.calculateVestedAmount(id);
        require(vested == 0 && claimed == 0, "fresh vesting: vested " + string(vested) + " claimed " + string(claimed));
        fastForward(52 * WEEK);
        (uint128 vestedLater, ) = pool.calculateVestedAmount(id);
        require(vestedLater == 1200, "half way " + string(vestedLater));
    }

    function it_rejects_direct_pool_calls_from_the_owner() public {
        uint64 start = uint64(block.timestamp);
        bool reverted = false;
        try pool.addVesting(address(alice), 0, true, 104, start, 2400) { } catch Error(string e) {
            reverted = true;
            require(e == "Can only be called by pool manager", e);
        }
        require(reverted, "direct pool call accepted");
        require(pool.totalTokensInVesting() == 0, "state changed");
    }

    function it_batches_one_category_per_call() public {
        uint64 start = uint64(block.timestamp);
        address[] memory accounts = new address[](2);
        uint128[] memory amounts = new uint128[](2);
        accounts[0] = address(alice); amounts[0] = 400;
        accounts[1] = address(bob); amounts[1] = 600;
        manager.addVestings(accounts, amounts, false, 104, start);
        require(pool.totalTokensInVesting() == 1000, "batch committed " + string(pool.totalTokensInVesting()));
        bytes32 aliceId = pool.vestingHash(address(alice), 0, false, 104, start, 400);
        bytes32 bobId = pool.vestingHash(address(bob), 0, false, 104, start, 600);
        (uint128 va, ) = pool.calculateVestedAmount(aliceId);
        (uint128 vb, ) = pool.calculateVestedAmount(bobId);
        require(va == 0 && vb == 0, "both vestings exist and are fresh");
        fastForward(104 * WEEK);
        (uint128 vaEnd, ) = pool.calculateVestedAmount(aliceId);
        (uint128 vbEnd, ) = pool.calculateVestedAmount(bobId);
        require(vaEnd == 400 && vbEnd == 600, "amounts per account: " + string(vaEnd) + " / " + string(vbEnd));
    }

    function it_rejects_malformed_batches_without_changing_state() public {
        uint64 start = uint64(block.timestamp);
        address[] memory accounts = new address[](2);
        uint128[] memory amounts = new uint128[](1);
        accounts[0] = address(alice); accounts[1] = address(bob); amounts[0] = 400;
        bool reverted = false;
        try manager.addVestings(accounts, amounts, false, 104, start) { } catch { reverted = true; }
        require(reverted, "length mismatch accepted");
        require(pool.totalTokensInVesting() == 0, "mismatch changed state");
        address[] memory none = new address[](0);
        uint128[] memory noAmounts = new uint128[](0);
        reverted = false;
        try manager.addVestings(none, noAmounts, false, 104, start) { } catch { reverted = true; }
        require(reverted, "empty batch accepted");
        require(pool.totalTokensInVesting() == 0, "empty batch changed state");
    }

    function it_forwards_cancel_only_for_managed_vestings() public {
        uint64 start = uint64(block.timestamp);
        manager.addVesting(address(alice), 0, true, 104, start, 2400);
        manager.addVesting(address(bob), 0, false, 104, start, 2400);
        bytes32 aliceId = pool.vestingHash(address(alice), 0, true, 104, start, 2400);
        bytes32 bobId = pool.vestingHash(address(bob), 0, false, 104, start, 2400);
        fastForward(26 * WEEK);
        bool reverted = false;
        try manager.cancelVesting(bobId) { } catch { reverted = true; }
        require(reverted, "unmanaged vesting was cancelled through the manager");
        require(pool.totalTokensInVesting() == 4800, "failed cancel changed state");
        manager.cancelVesting(aliceId);
        require(pool.totalTokensInVesting() == 2400 + 600, "committed after cancel " + string(pool.totalTokensInVesting()));
        fastForward(52 * WEEK);
        (uint128 frozen, ) = pool.calculateVestedAmount(aliceId);
        require(frozen == 600, "frozen at " + string(frozen));
        alice.do(address(pool), "claimVestedTokens", aliceId, address(alice), MAX128);
        require(strato.balanceOf(address(alice)) == 600, "alice claims exactly the frozen part");
        (uint128 bobVested, ) = pool.calculateVestedAmount(bobId);
        require(bobVested == 1800, "bob keeps vesting: " + string(bobVested));
    }

    function it_forwards_pause_and_unpause() public {
        uint64 start = uint64(block.timestamp);
        manager.addVesting(address(carol), 0, true, 104, start, 2400);
        bytes32 id = pool.vestingHash(address(carol), 0, true, 104, start, 2400);
        fastForward(26 * WEEK);
        manager.pauseVesting(id);
        fastForward(26 * WEEK);
        (uint128 paused, ) = pool.calculateVestedAmount(id);
        require(paused == 600, "accrued while paused: " + string(paused));
        manager.unpauseVesting(id);
        fastForward(26 * WEEK);
        (uint128 resumed, ) = pool.calculateVestedAmount(id);
        require(resumed == 1200, "after resume: " + string(resumed));
    }

    function it_rejects_non_owner_calls_and_leaves_state_unchanged() public {
        uint64 start = uint64(block.timestamp);
        manager.addVesting(address(alice), 0, true, 104, start, 2400);
        bytes32 aliceId = pool.vestingHash(address(alice), 0, true, 104, start, 2400);
        bool reverted = false;
        try bob.do(address(manager), "addVesting", address(bob), uint8(0), true, uint16(104), start, uint128(2400)) { } catch { reverted = true; }
        require(reverted, "non-owner created a vesting");
        require(pool.totalTokensInVesting() == 2400, "non-owner changed committed total");
        reverted = false;
        try bob.do(address(manager), "cancelVesting", aliceId) { } catch { reverted = true; }
        require(reverted, "non-owner cancelled a vesting");
        fastForward(52 * WEEK);
        (uint128 vested, ) = pool.calculateVestedAmount(aliceId);
        require(vested == 1200, "vesting was frozen by a non-owner: " + string(vested));
        reverted = false;
        try bob.do(address(manager), "pauseVesting", aliceId) { } catch { reverted = true; }
        require(reverted, "non-owner paused a vesting");
    }

    function it_rotates_control_with_transferOwnership() public {
        uint64 start = uint64(block.timestamp);
        manager.transferOwnership(address(carol));
        require(manager.owner() == address(carol), "ownership not transferred");
        require(pool.poolManager() == address(manager), "pool manager must not change on rotation");
        carol.do(address(manager), "addVesting", address(alice), uint8(0), true, uint16(104), start, uint128(2400));
        require(pool.totalTokensInVesting() == 2400, "new owner could not create a vesting");
        bool reverted = false;
        try manager.addVesting(address(bob), 0, true, 104, start, 1000) { } catch { reverted = true; }
        require(reverted, "old owner still has control");
        require(pool.totalTokensInVesting() == 2400, "old owner changed state");
    }

    function it_lets_beneficiaries_claim_directly_on_the_pool() public {
        uint64 start = uint64(block.timestamp);
        manager.addVesting(address(alice), 0, false, 104, start, 2400);
        bytes32 id = pool.vestingHash(address(alice), 0, false, 104, start, 2400);
        fastForward(52 * WEEK);
        alice.do(address(pool), "claimVestedTokens", id, address(alice), MAX128);
        require(strato.balanceOf(address(alice)) == 1200, "alice balance " + string(strato.balanceOf(address(alice))));
        require(pool.totalTokensInVesting() == 1200, "committed after claim " + string(pool.totalTokensInVesting()));
        bob.doExpectingFailure(address(pool), "claimVestedTokens", "Can only be claimed by vesting owner", id, address(bob), uint128(1));
    }

    function it_recycles_uncommitted_tokens_to_treasury_via_a_zero_week_vesting() public {
        uint64 start = uint64(block.timestamp);
        manager.addVesting(address(alice), 0, true, 104, start, 2400);
        bytes32 aliceId = pool.vestingHash(address(alice), 0, true, 104, start, 2400);
        fastForward(26 * WEEK);
        manager.cancelVesting(aliceId);
        uint256 uncommitted = pool.tokensAvailableForVesting();
        require(uncommitted == 10000 - 600, "uncommitted after cancel " + string(uncommitted));
        // treasury (this contract) takes the uncommitted tokens through an instant vesting
        manager.addVesting(address(this), 0, false, 0, uint64(block.timestamp), uint128(uncommitted));
        bytes32 tId = pool.vestingHash(address(this), 0, false, 0, uint64(block.timestamp), uint128(uncommitted));
        pool.claimVestedTokens(tId, address(this), MAX128);
        require(strato.balanceOf(address(this)) == uncommitted, "treasury received " + string(strato.balanceOf(address(this))));
        require(pool.tokensAvailableForVesting() == 0, "pool still has uncommitted tokens");
    }
}
