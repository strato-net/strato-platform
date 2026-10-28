import "../../concrete/Tokenomics/CalendarMonths.sol";

contract record CalendarHarness is CalendarMonths {
    function civil(uint ts) public pure returns (uint, uint, uint) { return _civil(ts / SECONDS_PER_DAY); }
    function monthsBetween(uint a, uint b) public pure returns (uint) { return _monthsBetween(a, b); }
    function addMonths(uint t, uint k) public pure returns (uint) { return _addMonths(t, k); }
}

contract Describe_CalendarMonths {
    uint constant DAY = 86400;
    uint constant TGE = 1792972800;          // 2026-10-26 00:00:00 UTC
    uint constant JAN31_2027 = 1801353600;   // 2027-01-31 00:00:00 UTC
    uint constant JAN31_2028 = 1832889600;   // 2028-01-31 00:00:00 UTC

    CalendarHarness h;

    function beforeAll() public {
        h = new CalendarHarness();
    }

    function _date(uint ts, uint y, uint m, uint d) internal {
        (uint yy, uint mm, uint dd) = h.civil(ts);
        require(yy == y && mm == m && dd == d, "civil(" + string(ts) + ") = " + string(yy) + "-" + string(mm) + "-" + string(dd));
    }

    function it_converts_timestamps_to_civil_dates() public {
        _date(0, 1970, 1, 1);
        _date(TGE, 2026, 10, 26);
        _date(TGE - 1, 2026, 10, 25);
        _date(951782400, 2000, 2, 29);   // leap day in a /400 year
        _date(4107542400, 2100, 3, 1);   // 2100 is not a leap year
        _date(JAN31_2028 + 29 * DAY, 2028, 2, 29);
    }

    function it_counts_months_on_monthly_anniversaries() public {
        require(h.monthsBetween(TGE, TGE) == 0, "TGE is month 0");
        require(h.monthsBetween(TGE, TGE - 1) == 0, "before TGE is 0");
        require(h.monthsBetween(TGE, TGE + 31 * DAY - 1) == 0, "Nov 25 23:59:59 is still month 0");
        require(h.monthsBetween(TGE, TGE + 31 * DAY) == 1, "Nov 26 starts month 1");
        require(h.monthsBetween(TGE, TGE + 365 * DAY) == 12, "Oct 26 2027 starts month 12");
        require(h.monthsBetween(TGE, TGE + 365 * DAY - 1) == 11, "a second earlier is month 11");
        // 2026-10-26 + 10 years (three leap days) = 2036-10-26
        require(h.monthsBetween(TGE, TGE + 3653 * DAY) == 120, "Oct 26 2036 starts month 120");
    }

    function it_honours_time_of_day() public {
        uint start = TGE + 15 * 3600;  // 15:00 UTC
        require(h.monthsBetween(start, TGE + 31 * DAY + 15 * 3600 - 1) == 0, "14:59:59 on the anniversary");
        require(h.monthsBetween(start, TGE + 31 * DAY + 15 * 3600) == 1, "15:00:00 on the anniversary");
    }

    function it_clamps_anniversaries_to_short_months() public {
        require(h.monthsBetween(JAN31_2027, JAN31_2027 + 27 * DAY) == 0, "Feb 27 2027");
        require(h.monthsBetween(JAN31_2027, JAN31_2027 + 28 * DAY) == 1, "Feb 28 2027 (no Feb 29)");
        require(h.monthsBetween(JAN31_2027, JAN31_2027 + 58 * DAY) == 1, "Mar 30 2027");
        require(h.monthsBetween(JAN31_2027, JAN31_2027 + 59 * DAY) == 2, "Mar 31 2027");
        require(h.monthsBetween(JAN31_2027, JAN31_2027 + 89 * DAY) == 3, "Apr 30 2027");
        require(h.monthsBetween(JAN31_2028, JAN31_2028 + 28 * DAY) == 0, "Feb 28 2028 (leap year)");
        require(h.monthsBetween(JAN31_2028, JAN31_2028 + 29 * DAY) == 1, "Feb 29 2028");
    }

    function it_adds_months_to_the_anniversary_that_starts_them() public {
        require(h.addMonths(TGE, 0) == TGE, "month 0 is TGE");
        require(h.addMonths(TGE, 1) == TGE + 31 * DAY, "Nov 26");
        require(h.addMonths(TGE, 24) == TGE + 731 * DAY, "Oct 26 2028 (one leap day)");
        require(h.addMonths(JAN31_2027, 1) == JAN31_2027 + 28 * DAY, "Feb 28 2027");
        require(h.addMonths(JAN31_2028, 1) == JAN31_2028 + 29 * DAY, "Feb 29 2028");
        require(h.addMonths(JAN31_2027, 2) == JAN31_2027 + 59 * DAY, "Mar 31 2027");
        uint[] memory starts = new uint[](3);
        starts[0] = TGE + 15 * 3600;
        starts[1] = JAN31_2027;
        starts[2] = JAN31_2028 + 1;
        for (uint i = 0; i < starts.length; i++) {
            for (uint k = 1; k <= 40; k++) {
                uint t = h.addMonths(starts[i], k);
                require(h.monthsBetween(starts[i], t) == k, "month " + string(k) + " starts at addMonths");
                require(h.monthsBetween(starts[i], t - 1) == k - 1, "and not a second earlier, month " + string(k));
            }
        }
    }
}
