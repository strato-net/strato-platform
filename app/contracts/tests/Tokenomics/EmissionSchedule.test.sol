import "../../concrete/Tokenomics/EmissionSchedule.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../Util.sol";

contract Describe_EmissionSchedule {
    uint constant DAY = 86400;
    uint constant TGE_2026 = 1792972800;  // 2026-10-26 00:00:00 UTC

    TokenFactory factory;
    Token strato;
    User treasury;
    User stranger;
    uint TGE;  // see VestingSchedule.test.sol

    function beforeAll() public {
        treasury = new User();
        stranger = new User();
    }

    function beforeEach() public {
        factory = new TokenFactory(address(this));
        strato = Token(factory.createTokenWithInitialOwner("STRATO", "STRATO Token", new string[](0), new string[](0), new string[](0), "STRATO", 0, 18, address(this)));
        strato.setStatus(2);
        TGE = TGE_2026;
        while (TGE <= block.timestamp) TGE += 1461 * DAY;
    }

    function _warpTo(uint ts) internal {
        require(ts > block.timestamp, "warp target " + string(ts) + " is not after now " + string(block.timestamp));
        fastForward(ts - block.timestamp);
    }

    // Three years of 1200, 600 and 301 (the last not divisible by 12).
    function _stream() internal returns (EmissionSchedule) {
        uint[] memory yearly = new uint[](3);
        yearly[0] = 1200;
        yearly[1] = 600;
        yearly[2] = 301;
        EmissionSchedule s = new EmissionSchedule("Test", address(strato), TGE, address(treasury), yearly, address(this));
        strato.mint(address(s), s.total());
        s.finalize();
        return s;
    }

    function it_emits_each_year_evenly_by_month() public {
        EmissionSchedule s = _stream();
        require(s.total() == 2101, "total");
        require(s.yearCount() == 3, "years");
        require(s.cumulativeUnlocked(0) == 0, "nothing at TGE");
        require(s.cumulativeUnlocked(1) == 100, "year 1 month 1");
        require(s.cumulativeUnlocked(12) == 1200, "end of year 1");
        require(s.cumulativeUnlocked(13) == 1250, "year 2 month 1");
        require(s.cumulativeUnlocked(24) == 1800, "end of year 2");
        require(s.cumulativeUnlocked(25) == 1825, "year 3 month 1 floors 301/12");
        require(s.cumulativeUnlocked(35) == 2075, "year 3 month 11 floors 301*11/12");
        require(s.cumulativeUnlocked(36) == 2101, "everything at the end");
        require(s.cumulativeUnlocked(1000) == 2101, "and after");
    }

    function it_releases_only_to_the_recipient() public {
        EmissionSchedule s = _stream();
        try s.release() { revert("released before TGE"); } catch Error(string e) {
            require(e == "EmissionSchedule: nothing to release", e);
        }
        _warpTo(TGE);
        require(s.releasable() == 0, "nothing at TGE");

        _warpTo(TGE + 31 * DAY);  // Nov 26
        stranger.do(address(s), "release");
        require(strato.balanceOf(address(treasury)) == 100, "month 1 to the treasury");
        require(strato.balanceOf(address(stranger)) == 0, "caller gets nothing");

        _warpTo(TGE + 3 * 365 * DAY + 1 * DAY);  // Oct 26 three years on (one leap day)
        require(s.monthsSinceTge() == 36, "month 36");
        s.release();
        require(strato.balanceOf(address(treasury)) == 2101, "fully emitted");
        require(s.released() == 2101, "released");
        require(strato.balanceOf(address(s)) == 0, "drained");
    }

    function it_rejects_bad_parameters() public {
        try new EmissionSchedule("Bad", address(strato), TGE, address(0), new uint[](1), address(this)) { revert("zero recipient"); } catch Error(string e) {
            require(e == "EmissionSchedule: recipient is zero", e);
        }
        try new EmissionSchedule("Bad", address(strato), TGE, address(treasury), new uint[](0), address(this)) { revert("no years"); } catch Error(string e) {
            require(e == "EmissionSchedule: no years", e);
        }
    }

    // The pre-TGE deduction lands in the table during setup; finalize then needs the
    // adjusted total, and nothing can change afterwards.
    function it_adjusts_the_table_only_during_setup() public {
        uint[] memory initial = new uint[](3);
        initial[0] = 1200;
        initial[1] = 600;
        initial[2] = 300;
        EmissionSchedule s = new EmissionSchedule("Test", address(strato), TGE, address(treasury), initial, address(this));
        uint[] memory yearly = new uint[](2);
        yearly[0] = 840;
        yearly[1] = 600;
        s.setYearlyAmounts(yearly);
        require(s.total() == 1440 && s.yearCount() == 2, "table replaced");
        require(s.cumulativeUnlocked(1) == 70, "year 1 shrinks evenly");
        require(s.cumulativeUnlocked(36) == 1440, "the dropped third year is gone");

        strato.mint(address(s), 1439);
        try s.finalize() { revert("finalized underfunded"); } catch Error(string e) {
            require(e == "TokenomicsSchedule: underfunded", e);
        }
        _warpTo(TGE + 31 * DAY);
        try s.release() { revert("released before finalize"); } catch Error(string e) {
            require(e == "TokenomicsSchedule: not finalized", e);
        }
        strato.mint(address(s), 1);
        s.finalize();
        try s.setYearlyAmounts(yearly) { revert("changed after finalize"); } catch Error(string e) {
            require(e == "TokenomicsSchedule: caller is not setup admin", e);
        }
        s.release();
        require(strato.balanceOf(address(treasury)) == 70, "month 1 paid");
    }
}
