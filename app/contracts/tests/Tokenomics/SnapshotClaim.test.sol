import "../../concrete/Tokenomics/SnapshotClaim.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../Util.sol";

contract Describe_SnapshotClaim {
    uint256 constant WINDOW = 7776000; // 90 days
    address constant ALICE = address(0xa11ce);
    address constant BOB = address(0xb0b);
    address constant CAROL = address(0xca201);

    Token strato;
    SnapshotClaim drop;
    User loader;
    User stranger;
    User claimant;
    address recipient;

    function beforeAll() public {
        loader = new User();
        stranger = new User();
        claimant = new User();
        recipient = address(new User());
    }

    function beforeEach() public {
        TokenFactory factory = new TokenFactory(address(this));
        strato = Token(factory.createTokenWithInitialOwner("STRATO", "STRATO Token", new string[](0), new string[](0), new string[](0), "STRATO", 0, 18, address(this)));
        strato.setStatus(2);
        drop = new SnapshotClaim(address(strato), address(loader), recipient, WINDOW, address(this));
    }

    function _two(address a, address b) internal pure returns (address[] memory accounts) {
        accounts = new address[](2);
        accounts[0] = a;
        accounts[1] = b;
    }

    function _one(address a) internal pure returns (address[] memory accounts) {
        accounts = new address[](1);
        accounts[0] = a;
    }

    function _amounts2(uint256 x, uint256 y) internal pure returns (uint256[] memory amounts) {
        amounts = new uint256[](2);
        amounts[0] = x;
        amounts[1] = y;
    }

    function _amounts1(uint256 x) internal pure returns (uint256[] memory amounts) {
        amounts = new uint256[](1);
        amounts[0] = x;
    }

    function _load(address[] memory accounts, uint256[] memory amounts) internal {
        loader.doSuccessfully(address(drop), "setAllocations", accounts, amounts);
    }

    // ALICE 10, the claimant 20, loading closed, funded, sealed.
    function _sealed() internal {
        _load(_two(ALICE, address(claimant)), _amounts2(10e18, 20e18));
        loader.doSuccessfully(address(drop), "closeLoading()");
        strato.mint(address(drop), 30e18);
        drop.seal(30e18, 2);
    }

    function _sealRejected(uint256 total, uint256 count) internal returns (bool) {
        bool rejected = false;
        try drop.seal(total, count) {
        } catch {
            rejected = true;
        }
        return rejected;
    }

    function it_sets_allocations_idempotently_and_keeps_the_totals() public {
        _load(_two(ALICE, BOB), _amounts2(10e18, 20e18));
        require(drop.totalAllocated() == 30e18 && drop.allocationCount() == 2, "two accounts, 30");
        _load(_two(ALICE, BOB), _amounts2(10e18, 20e18));
        require(drop.totalAllocated() == 30e18 && drop.allocationCount() == 2, "the same batch twice changes nothing");

        _load(_one(ALICE), _amounts1(15e18));
        require(drop.allocation(ALICE) == 15e18 && drop.totalAllocated() == 35e18 && drop.allocationCount() == 2, "a new amount replaces the old");
        _load(_one(BOB), _amounts1(0));
        require(drop.allocation(BOB) == 0 && drop.totalAllocated() == 15e18 && drop.allocationCount() == 1, "0 removes an account");
        _load(_one(CAROL), _amounts1(0));
        require(drop.totalAllocated() == 15e18 && drop.allocationCount() == 1, "removing an account never loaded changes nothing");

        _load(_two(CAROL, CAROL), _amounts2(5e18, 7e18));
        require(drop.allocation(CAROL) == 7e18 && drop.totalAllocated() == 22e18 && drop.allocationCount() == 2, "within a batch the last amount wins");
    }

    function it_lets_only_the_loader_load_and_closes_loading_for_good() public {
        stranger.doExpectingFailure(address(drop), "setAllocations", "SC: loader only", _one(ALICE), _amounts1(1e18));
        bool rejected = false;
        try drop.setAllocations(_one(ALICE), _amounts1(1e18)) {
        } catch {
            rejected = true;
        }
        require(rejected, "not the owner either");
        loader.doExpectingFailure(address(drop), "setAllocations", "SC: bad batch", _two(ALICE, BOB), _amounts1(1e18));
        loader.doExpectingFailure(address(drop), "setAllocations", "SC: zero account", _one(address(0)), _amounts1(1e18));

        _load(_one(ALICE), _amounts1(1e18));
        stranger.doExpectingFailure(address(drop), "closeLoading()", "SC: loader only");
        loader.doSuccessfully(address(drop), "closeLoading()");
        require(drop.loadingClosed(), "closed");
        loader.doExpectingFailure(address(drop), "setAllocations", "SC: loading closed", _one(ALICE), _amounts1(2e18));
        loader.doExpectingFailure(address(drop), "closeLoading()", "SC: loading closed");
        require(drop.allocation(ALICE) == 1e18 && drop.totalAllocated() == 1e18, "the list is fixed");
    }

    function it_seals_only_a_closed_funded_list_that_matches_the_manifest() public {
        _load(_two(ALICE, BOB), _amounts2(10e18, 20e18));
        strato.mint(address(drop), 30e18);
        require(_sealRejected(30e18, 2), "loading must be closed first");
        loader.doSuccessfully(address(drop), "closeLoading()");

        require(_sealRejected(31e18, 2), "a total other than the list's is refused");
        require(_sealRejected(30e18, 3), "so is a count other than the list's");
        bool rejected = false;
        try loader.do(address(drop), "seal(uint256,uint256)", 30e18, 2) {
        } catch {
            rejected = true;
        }
        require(rejected, "only the owner seals");

        drop.seal(30e18, 2);
        require(drop.deadline() == block.timestamp + WINDOW, "claims run for the window from the seal");
        require(_sealRejected(30e18, 2), "sealed once");
    }

    function it_refuses_to_seal_an_underfunded_or_empty_list() public {
        _load(_two(ALICE, BOB), _amounts2(10e18, 20e18));
        loader.doSuccessfully(address(drop), "closeLoading()");
        strato.mint(address(drop), 30e18 - 1);
        require(_sealRejected(30e18, 2), "one wei short is refused");
        strato.mint(address(drop), 1);
        drop.seal(30e18, 2);

        SnapshotClaim empty = new SnapshotClaim(address(strato), address(loader), recipient, WINDOW, address(this));
        loader.doSuccessfully(address(empty), "closeLoading()");
        bool rejected = false;
        try empty.seal(0, 0) {
        } catch {
            rejected = true;
        }
        require(rejected, "nothing allocated, nothing to seal");
    }

    // The runbook's balance == total check could be blocked for good by anyone sending one wei
    // first. Holding more is accepted, and the excess leaves with the sweep.
    function it_seals_despite_a_stray_transfer_and_sweeps_the_excess() public {
        strato.mint(address(drop), 1);
        _sealed();
        require(drop.deadline() > 0, "sealed with one wei over");

        stranger.doSuccessfully(address(drop), "claimFor(address)", ALICE);
        fastForward(WINDOW);
        stranger.doSuccessfully(address(drop), "sweepExpired()");
        require(strato.balanceOf(recipient) == 20e18 + 1, "the unclaimed 20 and the stray wei");
        require(strato.balanceOf(address(drop)) == 0, "nothing left");
    }

    function it_pays_each_account_once_and_always_to_the_account() public {
        _load(_two(ALICE, address(claimant)), _amounts2(10e18, 20e18));
        loader.doSuccessfully(address(drop), "closeLoading()");
        strato.mint(address(drop), 30e18);
        stranger.doExpectingFailure(address(drop), "claimFor(address)", "SC: not sealed", ALICE);
        require(drop.claimable(ALICE) == 0, "nothing claimable before the seal");
        drop.seal(30e18, 2);

        require(drop.claimable(ALICE) == 10e18, "claimable once sealed");
        stranger.doSuccessfully(address(drop), "claimFor(address)", ALICE);
        require(strato.balanceOf(ALICE) == 10e18 && strato.balanceOf(address(stranger)) == 0, "paid to the account, not the caller");
        require(drop.claimed(ALICE) && drop.claimable(ALICE) == 0 && drop.totalClaimed() == 10e18, "recorded");
        require(drop.allocation(ALICE) == 10e18, "the allocation stays on record");
        stranger.doExpectingFailure(address(drop), "claimFor(address)", "SC: already claimed", ALICE);

        claimant.doSuccessfully(address(drop), "claim()");
        require(strato.balanceOf(address(claimant)) == 20e18, "an account claims for itself");
        claimant.doExpectingFailure(address(drop), "claim()", "SC: already claimed");
        stranger.doExpectingFailure(address(drop), "claim()", "SC: nothing to claim");
        require(strato.balanceOf(address(drop)) == 0 && drop.totalClaimed() == 30e18, "all paid out");
    }

    function it_closes_claims_at_the_deadline_and_lets_anyone_sweep_the_rest() public {
        _sealed();
        stranger.doExpectingFailure(address(drop), "sweepExpired()", "SC: claim window open");

        fastForward(WINDOW - 1);
        stranger.doSuccessfully(address(drop), "claimFor(address)", ALICE);
        require(strato.balanceOf(ALICE) == 10e18, "claims run until the deadline");
        stranger.doExpectingFailure(address(drop), "sweepExpired()", "SC: claim window open");

        fastForward(1);
        claimant.doExpectingFailure(address(drop), "claim()", "SC: claim window over");
        require(drop.claimable(address(claimant)) == 0, "nothing claimable after it");
        stranger.doSuccessfully(address(drop), "sweepExpired()");
        require(strato.balanceOf(recipient) == 20e18 && strato.balanceOf(address(drop)) == 0, "the unclaimed 20 go to the recipient");
        stranger.doExpectingFailure(address(drop), "sweepExpired()", "SC: nothing to sweep");
    }
}
