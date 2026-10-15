import "../../concrete/Tokenomics/VestingSchedule.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../Util.sol";

contract Describe_VestingSchedule {
    uint constant DAY = 86400;
    uint constant TGE_2026 = 1792972800;  // 2026-10-26 00:00:00 UTC

    // Block time carries over between tests, so each test gets the first Oct 26
    // still ahead of it. Whole 4-year steps keep the calendar the same: Nov 26 is
    // always 31 days on and the next Oct 26 365 days on.
    uint TGE;
    uint NOV26;
    uint OCT26_NEXT;

    TokenFactory factory;
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
        factory = new TokenFactory(address(this));
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

    function _schedule(uint cliff, uint cliffBps, uint months) internal returns (VestingSchedule) {
        return new VestingSchedule("Test", address(strato), TGE, cliff, cliffBps, months, address(this));
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

    function _grant(VestingSchedule s, address a, uint amount) internal {
        s.addGrants(_accounts(a), _amounts(amount));
    }

    // Grants alice 1200 and bob 2400, funds exactly and finalizes.
    function _live(uint cliff, uint cliffBps, uint months) internal returns (VestingSchedule) {
        VestingSchedule s = _schedule(cliff, cliffBps, months);
        address[] memory accounts = new address[](2);
        uint[] memory amounts = new uint[](2);
        accounts[0] = address(alice);
        accounts[1] = address(bob);
        amounts[0] = 1200e18;
        amounts[1] = 2400e18;
        s.addGrants(accounts, amounts);
        strato.mint(address(s), s.totalGranted());
        s.finalize();
        return s;
    }

    function it_rejects_impossible_schedules() public {
        try new VestingSchedule("Bad", address(strato), TGE, 0, 10001, 12, address(this)) { revert("accepted >100%"); } catch Error(string e) {
            require(e == "VestingSchedule: cliff unlock above 100%", e);
        }
        try new VestingSchedule("Bad", address(strato), TGE, 0, 2500, 0, address(this)) { revert("accepted a remainder that never vests"); } catch Error(string e) {
            require(e == "VestingSchedule: remainder never vests", e);
        }
    }

    function it_follows_the_team_curve() public {
        VestingSchedule s = _schedule(12, 0, 24);
        require(s.cumulativeUnlocked(2400, 0) == 0, "TGE");
        require(s.cumulativeUnlocked(2400, 11) == 0, "inside cliff");
        require(s.cumulativeUnlocked(2400, 12) == 0, "cliff month unlocks 0%");
        require(s.cumulativeUnlocked(2400, 13) == 100, "1/24 a month after the cliff");
        require(s.cumulativeUnlocked(2400, 35) == 2300, "23/24");
        require(s.cumulativeUnlocked(2400, 36) == 2400, "fully vested at 36");
        require(s.cumulativeUnlocked(2400, 500) == 2400, "stays fully vested");
    }

    function it_follows_the_advisor_and_fund_curves() public {
        VestingSchedule advisors = _schedule(0, 2500, 12);
        require(advisors.cumulativeUnlocked(1200, 0) == 300, "25% at TGE");
        require(advisors.cumulativeUnlocked(1200, 1) == 375, "+ 75%/12");
        require(advisors.cumulativeUnlocked(1200, 12) == 1200, "fully vested at 12");

        VestingSchedule fund = _schedule(0, 5000, 24);
        require(fund.cumulativeUnlocked(2400, 0) == 1200, "50% at TGE");
        require(fund.cumulativeUnlocked(2400, 1) == 1250, "+ 50%/24");
        require(fund.cumulativeUnlocked(2400, 24) == 2400, "fully vested at 24");

        VestingSchedule airdrop = _schedule(0, 10000, 0);
        require(airdrop.cumulativeUnlocked(777, 0) == 777, "airdrop is fully unlocked at TGE");
    }

    function it_never_leaves_dust() public {
        VestingSchedule s = _schedule(0, 2500, 7);
        uint amount = 1000000000000000000000001;  // indivisible by 4 and by 7
        uint prev = 0;
        for (uint m = 0; m <= 7; m++) {
            uint c = s.cumulativeUnlocked(amount, m);
            require(c >= prev, "monotone");
            prev = c;
        }
        require(prev == amount, "the last month pays the exact remainder");
    }

    function it_locks_setup_after_finalize() public {
        VestingSchedule s = _schedule(0, 0, 24);
        _grant(s, address(alice), 100e18);

        stranger.doExpectingFailure(address(s), "finalize", "TokenomicsSchedule: caller is not setup admin");
        stranger.doExpectingFailure(address(s), "setTgeTimestamp", "TokenomicsSchedule: caller is not setup admin", TGE + 1);
        try s.finalize() { revert("finalized unfunded"); } catch Error(string e) {
            require(e == "TokenomicsSchedule: underfunded", e);
        }
        try s.addGrants(_accounts(address(alice)), _amounts(1)) { revert("accepted a duplicate"); } catch Error(string e) {
            require(e == "VestingSchedule: duplicate beneficiary", e);
        }

        strato.mint(address(s), 99e18);
        try s.finalize() { revert("finalized partly funded"); } catch Error(string e) {
            require(e == "TokenomicsSchedule: underfunded", e);
        }
        strato.mint(address(s), 1e18);
        s.finalize();
        require(s.finalized(), "finalized");
        require(s.setupAdmin() == address(0), "admin dropped");
        try s.addGrants(_accounts(address(bob)), _amounts(1)) { revert("granted after finalize"); } catch Error(string e) {
            require(e == "TokenomicsSchedule: caller is not setup admin", e);
        }
        try s.setTgeTimestamp(TGE + 1) { revert("moved TGE after finalize"); } catch Error(string e) {
            require(e == "TokenomicsSchedule: caller is not setup admin", e);
        }
    }

    // A stray transfer must not be able to block finalization, and the excess is
    // never paid out.
    function it_ignores_excess_funding() public {
        VestingSchedule s = _schedule(0, 10000, 0);
        _grant(s, address(alice), 100e18);
        strato.mint(address(s), 101e18);
        s.finalize();
        _warpTo(TGE);
        s.release(address(alice));
        require(strato.balanceOf(address(alice)) == 100e18, "alice gets her grant only");
        require(strato.balanceOf(address(s)) == 1e18, "excess stays locked");
    }

    function it_releases_nothing_before_finalize_or_tge() public {
        VestingSchedule s = _schedule(0, 10000, 0);
        _grant(s, address(alice), 100e18);
        strato.mint(address(s), 100e18);
        _warpTo(TGE);
        try s.release(address(alice)) { revert("released before finalize"); } catch Error(string e) {
            require(e == "TokenomicsSchedule: not finalized", e);
        }

        VestingSchedule early = _live(0, 10000, 0);
        require(early.vested(address(alice)) == 1200e18, "fully vested at TGE");
    }

    function it_releases_on_schedule_to_the_beneficiary() public {
        VestingSchedule s = _live(0, 2500, 12);  // advisors
        require(s.vested(address(alice)) == 0, "nothing before TGE");
        try s.release(address(alice)) { revert("released before TGE"); } catch Error(string e) {
            require(e == "VestingSchedule: nothing to release", e);
        }

        _warpTo(TGE);
        // Anyone may trigger a release; the tokens always go to the beneficiary.
        stranger.do(address(s), "release", address(alice));
        require(strato.balanceOf(address(alice)) == 300e18, "25% at TGE");
        require(strato.balanceOf(address(stranger)) == 0, "caller gets nothing");
        try s.release(address(alice)) { revert("double release"); } catch Error(string e) {
            require(e == "VestingSchedule: nothing to release", e);
        }

        _warpTo(NOV26 - 1);
        require(s.releasable(address(alice)) == 0, "still month 0");
        _warpTo(NOV26);
        s.release(address(alice));
        require(strato.balanceOf(address(alice)) == 375e18, "month 1");

        _warpTo(OCT26_NEXT);
        address[] memory both = new address[](3);
        both[0] = address(alice);
        both[1] = address(bob);
        both[2] = address(stranger);  // no grant: skipped
        s.releaseMany(both);
        require(strato.balanceOf(address(alice)) == 1200e18, "alice fully vested");
        require(strato.balanceOf(address(bob)) == 2400e18, "bob fully vested");
        require(s.totalReleased() == 3600e18, "totalReleased");
        require(strato.balanceOf(address(s)) == 0, "schedule drained");
    }

    // TGE stays adjustable until finalize, so the contracts can be deployed and
    // funded before the date is final.
    function it_lets_setup_move_tge() public {
        VestingSchedule s = _schedule(0, 10000, 0);
        _grant(s, address(alice), 100e18);
        s.setTgeTimestamp(TGE + 2 * DAY);
        require(s.tgeTimestamp() == TGE + 2 * DAY, "moved");
        strato.mint(address(s), 100e18);
        s.finalize();
        _warpTo(TGE);
        require(s.vested(address(alice)) == 0, "the old date unlocks nothing");
        _warpTo(TGE + 2 * DAY);
        require(s.vested(address(alice)) == 100e18, "the new date does");
    }

    function it_waits_out_the_team_cliff() public {
        VestingSchedule s = _live(12, 0, 24);
        _warpTo(OCT26_NEXT);
        require(s.monthsSinceTge() == 12, "month 12");
        require(s.vested(address(bob)) == 0, "cliff month unlocks nothing");
        _warpTo(OCT26_NEXT + 31 * DAY);  // Nov 26 of the next year
        s.release(address(bob));
        require(strato.balanceOf(address(bob)) == 100e18, "1/24 of 2400");
    }
}
