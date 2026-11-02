import "../../concrete/Tokenomics/VestingPoolManager.sol";
import "../../concrete/Admin/AdminRegistry.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../Util.sol";

// The manager's owner is the AdminRegistry (decided 2026-11-02). Every manager call by
// an admin is therefore a vote: the repo Ownable catches the failed owner check and
// routes the call into AdminRegistry.castVoteOnIssue; at quorum the registry calls the
// manager back as its owner. These tests drive that path with a real AdminRegistry
// (three admins, default threshold 60 % → two votes execute) and record what an admin
// sees when the pool rejects the call during execution.
contract Describe_VestingPoolManagerGovernance {
    uint constant WEEK = 604800;
    uint128 constant MAX = 340282366920938463463374607431768211455;

    Token strato;
    AdminRegistry registry;
    VestingPoolManager manager;
    VestingPool pool;
    Admin a1;
    Admin a2;
    Admin a3;
    User stranger;
    User alice;
    User bob;

    function beforeAll() public {
        a1 = new Admin();
        a2 = new Admin();
        a3 = new Admin();
        stranger = new User();
        alice = new User();
        bob = new User();
    }

    function beforeEach() public {
        registry = new AdminRegistry();
        address[] memory admins = new address[](3);
        admins[0] = address(a1);
        admins[1] = address(a2);
        admins[2] = address(a3);
        registry.initialize(admins);
        TokenFactory factory = new TokenFactory(address(this));
        strato = Token(factory.createTokenWithInitialOwner("STRATO", "STRATO Token", new string[](0), new string[](0), new string[](0), "STRATO", 0, 18, address(this)));
        strato.setStatus(2);
        manager = new VestingPoolManager(address(strato), address(registry));
        pool = manager.pool();
        strato.mint(address(pool), 10000);
    }

    function it_wires_the_registry_as_owner() public {
        require(manager.owner() == address(registry), "owner is the registry");
        require(pool.poolManager() == address(manager), "pool manager is the manager");
        require(registry.admins(0) == address(a1) && registry.admins(2) == address(a3), "three admins");
        require(registry.defaultVotingThresholdBps() == 6000, "60% threshold");
    }

    function it_executes_addVesting_only_at_quorum() public {
        uint64 start = uint64(block.timestamp);
        a1.do(address(manager), "addVesting", address(alice), uint8(0), true, uint16(104), start, uint128(2400));
        require(pool.totalTokensInVesting() == 0, "one vote of three must not execute");
        a2.do(address(manager), "addVesting", address(alice), uint8(0), true, uint16(104), start, uint128(2400));
        require(pool.totalTokensInVesting() == 2400, "two votes execute: committed " + string(pool.totalTokensInVesting()));
        bytes32 id = pool.vestingHash(address(alice), 0, true, 104, start, 2400);
        (uint128 vested, uint128 claimed) = pool.calculateVestedAmount(id);
        require(vested == 0 && claimed == 0, "fresh vesting");
        // the executed issue is closed: a late third vote opens a NEW issue, it does not re-execute
        a3.do(address(manager), "addVesting", address(alice), uint8(0), true, uint16(104), start, uint128(2400));
        require(pool.totalTokensInVesting() == 2400, "a late vote must not create a duplicate");
    }

    function it_batches_by_vote() public {
        uint64 start = uint64(block.timestamp);
        address[] memory accounts = new address[](2);
        uint128[] memory amounts = new uint128[](2);
        accounts[0] = address(alice); amounts[0] = 400;
        accounts[1] = address(bob); amounts[1] = 600;
        a1.do(address(manager), "addVestings", accounts, amounts, false, uint16(104), start);
        require(pool.totalTokensInVesting() == 0, "no execution on the first vote");
        a2.do(address(manager), "addVestings", accounts, amounts, false, uint16(104), start);
        require(pool.totalTokensInVesting() == 1000, "batch executed: committed " + string(pool.totalTokensInVesting()));
        bytes32 bobId = pool.vestingHash(address(bob), 0, false, 104, start, 600);
        fastForward(104 * WEEK);
        bob.do(address(pool), "claimVestedTokens", bobId, address(bob), MAX);
        require(strato.balanceOf(address(bob)) == 600, "bob claims his batch entry directly on the pool");
    }

    function it_rejects_non_admins_and_leaves_state_unchanged() public {
        uint64 start = uint64(block.timestamp);
        bool reverted = false;
        try stranger.do(address(manager), "addVesting", address(alice), uint8(0), true, uint16(104), start, uint128(2400)) {
        } catch {
            reverted = true;
        }
        require(reverted, "a non-admin call must revert");
        require(pool.totalTokensInVesting() == 0, "nothing created");
    }

    function it_cancels_a_managed_vesting_by_vote() public {
        uint64 start = uint64(block.timestamp);
        a1.do(address(manager), "addVesting", address(alice), uint8(0), true, uint16(104), start, uint128(2400));
        a2.do(address(manager), "addVesting", address(alice), uint8(0), true, uint16(104), start, uint128(2400));
        bytes32 id = pool.vestingHash(address(alice), 0, true, 104, start, 2400);
        fastForward(26 * WEEK);
        a1.do(address(manager), "cancelVesting", id);
        require(pool.totalTokensInVesting() == 2400, "one vote does not cancel");
        a2.do(address(manager), "cancelVesting", id);
        require(pool.totalTokensInVesting() == 600, "cancelled: only the vested 600 stays committed, got " + string(pool.totalTokensInVesting()));
        fastForward(52 * WEEK);
        (uint128 vested, ) = pool.calculateVestedAmount(id);
        require(vested == 600, "frozen at cancel");
        alice.do(address(pool), "claimVestedTokens", id, address(alice), MAX);
        require(strato.balanceOf(address(alice)) == 600, "leaver keeps exactly the vested part");
    }

    // What an admin sees when the pool rejects the call at execution time: the second
    // (quorum) vote's transaction reverts and nothing is recorded for it. The first vote
    // stands, so once the cause is fixed a single re-vote executes the same issue.
    function it_surfaces_a_pool_rejection_during_execution_as_a_revert() public {
        uint64 start = uint64(block.timestamp);
        // 10000 funded, 20000 requested: the pool will reject with "Not enough tokens available"
        a1.do(address(manager), "addVesting", address(alice), uint8(0), true, uint16(104), start, uint128(20000));
        bool reverted = false;
        try a2.do(address(manager), "addVesting", address(alice), uint8(0), true, uint16(104), start, uint128(20000)) {
        } catch {
            reverted = true;
        }
        require(reverted, "the quorum vote must revert when the pool rejects the call");
        require(pool.totalTokensInVesting() == 0, "nothing committed");
        // Recovery: the first vote stands. Fix the cause (fund the pool) and re-vote.
        strato.mint(address(pool), 10000);
        a2.do(address(manager), "addVesting", address(alice), uint8(0), true, uint16(104), start, uint128(20000));
        require(pool.totalTokensInVesting() == 20000, "re-voting after funding executes: " + string(pool.totalTokensInVesting()));
        // cancelling an UNMANAGED vesting by vote fails the same way (fund it first:
        // the recovered 20000 vesting consumed everything the pool held)
        strato.mint(address(pool), 1000);
        a1.do(address(manager), "addVesting", address(bob), uint8(0), false, uint16(104), start, uint128(1000));
        a2.do(address(manager), "addVesting", address(bob), uint8(0), false, uint16(104), start, uint128(1000));
        bytes32 bobId = pool.vestingHash(address(bob), 0, false, 104, start, 1000);
        a1.do(address(manager), "cancelVesting", bobId);
        reverted = false;
        try a2.do(address(manager), "cancelVesting", bobId) {
        } catch {
            reverted = true;
        }
        require(reverted, "cancelling an unmanaged vesting must revert at execution");
        fastForward(52 * WEEK);
        (uint128 vested, ) = pool.calculateVestedAmount(bobId);
        require(vested == 500, "the unmanaged vesting keeps vesting: " + string(vested));
    }

    function it_executes_immediately_with_a_single_admin() public {
        AdminRegistry solo = new AdminRegistry();
        address[] memory admins = new address[](1);
        admins[0] = address(a1);
        solo.initialize(admins);
        VestingPoolManager m = new VestingPoolManager(address(strato), address(solo));
        strato.mint(address(m.pool()), 1000);
        a1.do(address(m), "addVesting", address(alice), uint8(0), true, uint16(52), uint64(block.timestamp), uint128(1000));
        require(m.pool().totalTokensInVesting() == 1000, "1 of 1 executes in the same transaction");
    }

    function it_rotates_the_owner_by_vote() public {
        a1.do(address(manager), "transferOwnership", address(alice));
        require(manager.owner() == address(registry), "one vote does not rotate");
        a2.do(address(manager), "transferOwnership", address(alice));
        require(manager.owner() == address(alice), "two votes rotate the owner");
        uint64 start = uint64(block.timestamp);
        alice.do(address(manager), "addVesting", address(bob), uint8(0), false, uint16(104), start, uint128(500));
        require(pool.totalTokensInVesting() == 500, "the new owner acts directly");
        bool reverted = false;
        try a1.do(address(manager), "addVesting", address(bob), uint8(0), false, uint16(104), start, uint128(700)) {
        } catch {
            reverted = true;
        }
        require(reverted, "admins lose control after rotation");
        require(pool.totalTokensInVesting() == 500, "no change from the ex-admin");
    }
}
