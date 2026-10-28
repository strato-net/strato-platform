import "../../concrete/Tokenomics/VestingClaims.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../Util.sol";

contract Describe_VestingClaims {
    uint constant DAY = 86400;
    uint constant TGE_2026 = 1792972800;  // 2026-10-26 00:00:00 UTC

    uint TGE;  // see MonthlyVestingWallet.test.sol
    uint NOV26;
    uint OCT26_NEXT;

    Token strato;
    User alice;
    User bob;
    User stranger;

    function beforeAll() public {
        alice = new User();
        bob = new User();
        stranger = new User();
    }

    function beforeEach() public {
        TokenFactory factory = new TokenFactory(address(this));
        strato = Token(factory.createTokenWithInitialOwner("STRATO", "STRATO Token", new string[](0), new string[](0), new string[](0), "STRATO", 0, 18, address(this)));
        strato.setStatus(2);
        TGE = TGE_2026;
        while (TGE <= block.timestamp) TGE += 1461 * DAY;
        NOV26 = TGE + 31 * DAY;
        OCT26_NEXT = TGE + 365 * DAY;
    }

    function _warpTo(uint ts) internal {
        require(ts > block.timestamp, "warp target " + string(ts) + " is not after now " + string(block.timestamp));
        fastForward(ts - block.timestamp);
    }

    function _claims(uint cliff, uint cliffBps, uint months) internal returns (VestingClaims) {
        return new VestingClaims("Test", address(strato), uint64(TGE), cliff, cliffBps, months, address(this));
    }

    function _accounts(address a) internal returns (address[]) {
        address[] memory accounts = new address[](1);
        accounts[0] = a;
        return accounts;
    }

    function _amounts(uint amount) internal returns (uint[]) {
        uint[] memory amounts = new uint[](1);
        amounts[0] = amount;
        return amounts;
    }

    // Grants alice `a` and bob `b`, funds the wallet with exactly that and finalizes.
    function _live(uint cliff, uint cliffBps, uint months, uint a, uint b) internal returns (VestingClaims) {
        VestingClaims c = _claims(cliff, cliffBps, months);
        address[] memory accounts = new address[](2);
        uint[] memory amounts = new uint[](2);
        accounts[0] = address(alice);
        accounts[1] = address(bob);
        amounts[0] = a;
        amounts[1] = b;
        c.addGrants(accounts, amounts);
        strato.mint(c.wallet(), c.totalGranted());
        c.finalize();
        return c;
    }

    function it_creates_its_wallet_as_the_fixed_beneficiary() public {
        VestingClaims c = _claims(12, 0, 24);
        MonthlyVestingWallet w = MonthlyVestingWallet(c.wallet());
        require(w.beneficiary() == address(c), "the claims contract is the beneficiary");
        require(w.category() == "Test", "category");
        require(w.start() == TGE, "start");
        require(w.cliffMonths() == 12 && w.cliffUnlockBps() == 0 && w.vestingMonths() == 24, "terms");
    }

    function it_locks_setup_after_finalize() public {
        VestingClaims c = _claims(0, 0, 24);
        try c.finalize() { revert("finalized with no grants"); } catch Error(string e) {
            require(e == "VestingClaims: nothing granted", e);
        }
        c.addGrants(_accounts(address(alice)), _amounts(100e18));

        stranger.doExpectingFailure(address(c), "finalize", "VestingClaims: caller is not setup admin");
        stranger.doExpectingFailure(address(c), "addGrants", "VestingClaims: caller is not setup admin", _accounts(address(bob)), _amounts(1));
        try c.addGrants(_accounts(address(alice)), _amounts(1)) { revert("accepted a duplicate"); } catch Error(string e) {
            require(e == "VestingClaims: duplicate member", e);
        }
        try c.addGrants(_accounts(address(bob)), _amounts(0)) { revert("accepted a zero grant"); } catch Error(string e) {
            require(e == "VestingClaims: amount is zero", e);
        }

        strato.mint(c.wallet(), 99e18);
        try c.finalize() { revert("finalized partly funded"); } catch Error(string e) {
            require(e == "VestingClaims: wallet underfunded", e);
        }
        strato.mint(c.wallet(), 1e18);
        c.finalize();
        require(c.finalized(), "finalized");
        require(c.setupAdmin() == address(0), "admin dropped");
        try c.addGrants(_accounts(address(bob)), _amounts(1)) { revert("granted after finalize"); } catch Error(string e) {
            require(e == "VestingClaims: caller is not setup admin", e);
        }
    }

    function it_claims_nothing_before_finalize() public {
        VestingClaims c = _claims(0, 10000, 0);
        c.addGrants(_accounts(address(alice)), _amounts(100e18));
        strato.mint(c.wallet(), 100e18);
        _warpTo(TGE);
        require(c.claimable(address(alice)) == 0, "nothing claimable");
        try c.claim(address(alice)) { revert("claimed before finalize"); } catch Error(string e) {
            require(e == "VestingClaims: not finalized", e);
        }
    }

    function it_pays_each_member_their_grant_s_schedule() public {
        VestingClaims c = _live(0, 2500, 12, 1200e18, 2400e18);  // advisors
        MonthlyVestingWallet w = MonthlyVestingWallet(c.wallet());
        try c.claim(address(alice)) { revert("claimed before TGE"); } catch Error(string e) {
            require(e == "VestingClaims: nothing to claim", e);
        }

        _warpTo(TGE);
        // Anyone may claim for a member; the tokens always go to the member.
        stranger.do(address(c), "claim", address(alice));
        require(strato.balanceOf(address(alice)) == 300e18, "25% at TGE");
        require(strato.balanceOf(address(stranger)) == 0, "caller gets nothing");
        try c.claim(address(alice)) { revert("double claim"); } catch Error(string e) {
            require(e == "VestingClaims: nothing to claim", e);
        }

        _warpTo(NOV26);
        require(c.claimable(address(bob)) == w.cumulativeUnlocked(2400e18, 1), "bob's share is his own schedule");
        c.claim(address(alice));
        require(strato.balanceOf(address(alice)) == 375e18, "month 1");

        _warpTo(OCT26_NEXT);
        address[] memory all = new address[](3);
        all[0] = address(alice);
        all[1] = address(bob);
        all[2] = address(stranger);  // no grant: skipped
        c.claimMany(all);
        require(strato.balanceOf(address(alice)) == 1200e18, "alice fully vested");
        require(strato.balanceOf(address(bob)) == 2400e18, "bob fully vested");
        require(c.totalClaimed() == 3600e18, "totalClaimed");
        require(strato.balanceOf(address(c)) == 0 && strato.balanceOf(address(w)) == 0, "drained");
    }

    // Pro-rata rounding leaves dust along the way, never at the end.
    function it_pays_every_grant_exactly_at_the_end() public {
        uint a = 1000000000000000000000001;
        uint b = 7;
        VestingClaims c = _live(0, 2500, 7, a, b);
        _warpTo(TGE);
        c.claim(address(alice));
        _warpTo(NOV26);
        c.claim(address(alice));
        c.claim(address(bob));
        _warpTo(OCT26_NEXT);
        c.claim(address(alice));
        c.claim(address(bob));
        require(strato.balanceOf(address(alice)) == a && strato.balanceOf(address(bob)) == b, "exact grants");
        require(strato.balanceOf(address(c)) == 0, "no dust left");
    }

    // A stray transfer cannot block finalization or get stuck: it is shared pro rata.
    function it_shares_excess_pro_rata() public {
        VestingClaims c = _claims(0, 10000, 0);
        address[] memory accounts = new address[](2);
        uint[] memory amounts = new uint[](2);
        accounts[0] = address(alice);
        accounts[1] = address(bob);
        amounts[0] = 100e18;
        amounts[1] = 200e18;
        c.addGrants(accounts, amounts);
        strato.mint(c.wallet(), 330e18);
        c.finalize();
        _warpTo(TGE);
        c.claimMany(accounts);
        require(strato.balanceOf(address(alice)) == 110e18 && strato.balanceOf(address(bob)) == 220e18, "pro rata");
    }
}
