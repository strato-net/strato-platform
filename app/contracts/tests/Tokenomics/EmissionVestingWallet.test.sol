import "../../concrete/Tokenomics/EmissionVestingWallet.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../Util.sol";

contract Describe_EmissionVestingWallet {
    uint constant DAY = 86400;
    uint constant TGE_2026 = 1792972800;  // 2026-10-26 00:00:00 UTC

    Token strato;
    User treasury;
    User stranger;
    uint TGE;  // see MonthlyVestingWallet.test.sol

    function beforeAll() public {
        treasury = new User();
        stranger = new User();
    }

    function beforeEach() public {
        TokenFactory factory = new TokenFactory(address(this));
        strato = Token(factory.createTokenWithInitialOwner("STRATO", "STRATO Token", new string[](0), new string[](0), new string[](0), "STRATO", 0, 18, address(this)));
        strato.setStatus(2);
        TGE = TGE_2026;
        while (TGE <= block.timestamp) TGE += 1461 * DAY;
    }

    function _warpTo(uint ts) internal {
        require(ts > block.timestamp, "warp target " + string(ts) + " is not after now " + string(block.timestamp));
        fastForward(ts - block.timestamp);
    }

    // Three years of 1200, 600 and 301 (the last not divisible by 12), funded.
    function _stream() internal returns (EmissionVestingWallet) {
        uint[] memory yearly = new uint[](3);
        yearly[0] = 1200;
        yearly[1] = 600;
        yearly[2] = 301;
        EmissionVestingWallet w = new EmissionVestingWallet("Test", address(treasury), uint64(TGE), yearly);
        strato.mint(address(w), w.total());
        return w;
    }

    function it_emits_each_year_evenly_by_month() public {
        EmissionVestingWallet w = _stream();
        require(w.total() == 2101, "total");
        require(w.yearCount() == 3, "years");
        require(w.start() == TGE && w.end() == TGE + 1096 * DAY, "spans three years");
        require(w.cumulativeUnlocked(0) == 0, "nothing at TGE");
        require(w.cumulativeUnlocked(1) == 100, "year 1 month 1");
        require(w.cumulativeUnlocked(12) == 1200, "end of year 1");
        require(w.cumulativeUnlocked(13) == 1250, "year 2 month 1");
        require(w.cumulativeUnlocked(24) == 1800, "end of year 2");
        require(w.cumulativeUnlocked(25) == 1825, "year 3 month 1 floors 301/12");
        require(w.cumulativeUnlocked(35) == 2075, "year 3 month 11 floors 301*11/12");
        require(w.cumulativeUnlocked(36) == 2101, "everything at the end");
        require(w.cumulativeUnlocked(1000) == 2101, "and after");
    }

    function it_releases_only_to_the_beneficiary() public {
        EmissionVestingWallet w = _stream();
        _warpTo(TGE);
        require(w.releasable(address(strato)) == 0, "nothing at TGE");

        _warpTo(TGE + 31 * DAY);  // Nov 26
        stranger.do(address(w), "release", address(strato));
        require(strato.balanceOf(address(treasury)) == 100, "month 1 to the treasury");
        require(strato.balanceOf(address(stranger)) == 0, "caller gets nothing");

        _warpTo(TGE + 1096 * DAY);  // Oct 26 three years on (one leap day)
        w.release(address(strato));
        require(strato.balanceOf(address(treasury)) == 2101, "fully emitted");
        require(w.released(address(strato)) == 2101, "released");
        require(strato.balanceOf(address(w)) == 0, "drained");
    }

    function it_vests_its_holdings_in_the_table_s_proportions() public {
        EmissionVestingWallet w = _stream();
        strato.mint(address(w), w.total());
        _warpTo(TGE + 31 * DAY);
        require(w.releasable(address(strato)) == 200, "twice the table, twice the emission");
    }

    function it_rejects_bad_parameters() public {
        try new EmissionVestingWallet("Bad", address(0), uint64(TGE), new uint[](1)) { revert("zero beneficiary"); } catch Error(string e) {
            require(e == "VestingWallet: beneficiary is zero", e);
        }
        try new EmissionVestingWallet("Bad", address(treasury), uint64(TGE), new uint[](0)) { revert("no years"); } catch Error(string e) {
            require(e == "EmissionVestingWallet: no years", e);
        }
        try new EmissionVestingWallet("Bad", address(treasury), uint64(TGE), new uint[](2)) { revert("all-zero table"); } catch Error(string e) {
            require(e == "EmissionVestingWallet: nothing to emit", e);
        }
    }
}
