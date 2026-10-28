import "../../concrete/Tokenomics/MonthlyVestingWallet.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../Util.sol";

contract Describe_MonthlyVestingWallet {
    uint constant DAY = 86400;
    uint constant TGE_2026 = 1792972800;  // 2026-10-26 00:00:00 UTC

    // Block time carries over between tests, so each test gets the first Oct 26
    // still ahead of it. Whole 4-year steps keep the calendar the same: Nov 26 is
    // always 31 days on, the next Oct 26 365 days on, and three years 1096 days.
    uint TGE;
    uint NOV26;
    uint OCT26_NEXT;

    Token strato;
    User alice;
    User stranger;

    function beforeAll() public {
        alice = new User();
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

    function _wallet(uint cliff, uint cliffBps, uint months) internal returns (MonthlyVestingWallet) {
        return new MonthlyVestingWallet("Test", address(alice), uint64(TGE), cliff, cliffBps, months);
    }

    function it_rejects_impossible_schedules() public {
        try new MonthlyVestingWallet("Bad", address(alice), uint64(TGE), 0, 10001, 12) { revert("accepted >100%"); } catch Error(string e) {
            require(e == "MonthlyVestingWallet: cliff unlock above 100%", e);
        }
        try new MonthlyVestingWallet("Bad", address(alice), uint64(TGE), 0, 2500, 0) { revert("accepted a remainder that never vests"); } catch Error(string e) {
            require(e == "MonthlyVestingWallet: remainder never vests", e);
        }
        try new MonthlyVestingWallet("Bad", address(0), uint64(TGE), 0, 0, 12) { revert("accepted zero beneficiary"); } catch Error(string e) {
            require(e == "VestingWallet: beneficiary is zero", e);
        }
    }

    function it_spans_whole_calendar_months() public {
        MonthlyVestingWallet team = _wallet(12, 0, 24);
        require(team.category() == "Test", "category");
        require(team.beneficiary() == address(alice), "beneficiary");
        require(team.start() == TGE, "starts at TGE");
        require(team.end() == TGE + 1096 * DAY, "ends 36 months on");
        require(_wallet(0, 2500, 12).end() == OCT26_NEXT, "advisors end 12 months on");
        require(_wallet(0, 10000, 0).end() == TGE, "airdrop ends at TGE");
    }

    function it_follows_the_team_curve() public {
        MonthlyVestingWallet w = _wallet(12, 0, 24);
        require(w.cumulativeUnlocked(2400, 0) == 0, "TGE");
        require(w.cumulativeUnlocked(2400, 11) == 0, "inside cliff");
        require(w.cumulativeUnlocked(2400, 12) == 0, "cliff month unlocks 0%");
        require(w.cumulativeUnlocked(2400, 13) == 100, "1/24 a month after the cliff");
        require(w.cumulativeUnlocked(2400, 35) == 2300, "23/24");
        require(w.cumulativeUnlocked(2400, 36) == 2400, "fully vested at 36");
        require(w.cumulativeUnlocked(2400, 500) == 2400, "stays fully vested");
    }

    function it_follows_the_advisor_and_fund_curves() public {
        MonthlyVestingWallet advisors = _wallet(0, 2500, 12);
        require(advisors.cumulativeUnlocked(1200, 0) == 300, "25% at TGE");
        require(advisors.cumulativeUnlocked(1200, 1) == 375, "+ 75%/12");
        require(advisors.cumulativeUnlocked(1200, 12) == 1200, "fully vested at 12");

        MonthlyVestingWallet fund = _wallet(0, 5000, 24);
        require(fund.cumulativeUnlocked(2400, 0) == 1200, "50% at TGE");
        require(fund.cumulativeUnlocked(2400, 1) == 1250, "+ 50%/24");
        require(fund.cumulativeUnlocked(2400, 24) == 2400, "fully vested at 24");

        MonthlyVestingWallet airdrop = _wallet(0, 10000, 0);
        require(airdrop.cumulativeUnlocked(777, 0) == 777, "airdrop is fully unlocked at TGE");
    }

    function it_never_leaves_dust() public {
        MonthlyVestingWallet w = _wallet(0, 2500, 7);
        uint amount = 1000000000000000000000001;  // indivisible by 4 and by 7
        uint prev = 0;
        for (uint m = 0; m <= 7; m++) {
            uint c = w.cumulativeUnlocked(amount, m);
            require(c >= prev, "monotone");
            prev = c;
        }
        require(prev == amount, "the last month pays the exact remainder");
    }

    function it_releases_on_calendar_months_to_the_beneficiary() public {
        MonthlyVestingWallet w = _wallet(0, 2500, 12);  // advisors
        strato.mint(address(w), 1200e18);
        require(w.releasable(address(strato)) == 0, "nothing before TGE");

        _warpTo(TGE);
        stranger.do(address(w), "release", address(strato));
        require(strato.balanceOf(address(alice)) == 300e18, "25% at TGE");
        require(strato.balanceOf(address(stranger)) == 0, "caller gets nothing");

        _warpTo(NOV26 - 1);
        require(w.releasable(address(strato)) == 0, "still month 0");
        _warpTo(NOV26);
        w.release(address(strato));
        require(strato.balanceOf(address(alice)) == 375e18, "month 1");

        _warpTo(OCT26_NEXT);
        w.release(address(strato));
        require(strato.balanceOf(address(alice)) == 1200e18, "fully vested");
        require(w.released(address(strato)) == 1200e18, "released");
        require(strato.balanceOf(address(w)) == 0, "drained");
    }

    function it_waits_out_the_team_cliff() public {
        MonthlyVestingWallet w = _wallet(12, 0, 24);
        strato.mint(address(w), 2400e18);
        _warpTo(OCT26_NEXT);
        require(w.releasable(address(strato)) == 0, "cliff month unlocks nothing");
        _warpTo(OCT26_NEXT + 31 * DAY);  // Nov 26 of the next year
        w.release(address(strato));
        require(strato.balanceOf(address(alice)) == 100e18, "1/24 of 2400");
    }

    // As in OpenZeppelin's wallet, whatever it holds follows the schedule.
    function it_vests_extra_tokens_in_the_same_proportions() public {
        MonthlyVestingWallet w = _wallet(0, 2500, 12);
        strato.mint(address(w), 1200e18);
        _warpTo(TGE);
        w.release(address(strato));
        strato.mint(address(w), 1200e18);
        require(w.releasable(address(strato)) == 300e18, "25% of the extra is releasable at once");
    }
}
