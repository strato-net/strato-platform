// Calendar-month arithmetic for the tokenomics schedules (UTC, proleptic Gregorian).
//
// The tokenomics model unlocks in whole calendar months counted from TGE. Month k
// begins on the k-th monthly anniversary of TGE: same day of month and time of day,
// clamped to the last day of a shorter month (a TGE on the 31st anniversaries on
// Feb 28/29, Apr 30, ...). Month 0 is TGE itself.
abstract contract CalendarMonths {
    uint constant SECONDS_PER_DAY = 86400;

    // Days since 1970-01-01 to (year, month, day); Howard Hinnant's civil_from_days.
    function _civil(uint daysSinceEpoch) internal pure returns (uint, uint, uint) {
        uint z = daysSinceEpoch + 719468;
        uint era = z / 146097;
        uint doe = z - era * 146097;
        uint yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        uint doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint mp = (5 * doy + 2) / 153;
        uint d = doy - (153 * mp + 2) / 5 + 1;
        uint m = mp < 10 ? mp + 3 : mp - 9;
        uint y = yoe + era * 400;
        if (m <= 2) y += 1;
        return (y, m, d);
    }

    // (year, month, day) to days since 1970-01-01; Howard Hinnant's days_from_civil.
    function _daysFromCivil(uint y, uint m, uint d) internal pure returns (uint) {
        if (m <= 2) y -= 1;
        uint era = y / 400;
        uint yoe = y - era * 400;
        uint mp = m > 2 ? m - 3 : m + 9;
        uint doy = (153 * mp + 2) / 5 + d - 1;
        uint doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return era * 146097 + doe - 719468;
    }

    function _daysInMonth(uint y, uint m) internal pure returns (uint) {
        if (m == 2) {
            bool leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
            return leap ? 29 : 28;
        }
        if (m == 4 || m == 6 || m == 9 || m == 11) return 30;
        return 31;
    }

    // Whole calendar months from `start` to `t`; zero when t < start.
    function _monthsBetween(uint start, uint t) internal pure returns (uint) {
        if (t < start) return 0;
        (uint y1, uint m1, uint d1) = _civil(start / SECONDS_PER_DAY);
        (uint y2, uint m2, uint d2) = _civil(t / SECONDS_PER_DAY);
        uint months = (y2 * 12 + m2) - (y1 * 12 + m1);

        uint anniversary = d1;
        uint dim = _daysInMonth(y2, m2);
        if (anniversary > dim) anniversary = dim;
        uint tod1 = start % SECONDS_PER_DAY;
        uint tod2 = t % SECONDS_PER_DAY;
        if (d2 < anniversary || (d2 == anniversary && tod2 < tod1)) months -= 1;
        return months;
    }

    // The start of month `months` counted from `start`: its `months`-th monthly anniversary.
    function _addMonths(uint start, uint months) internal pure returns (uint) {
        (uint y, uint m, uint d) = _civil(start / SECONDS_PER_DAY);
        uint index = y * 12 + m - 1 + months;
        y = index / 12;
        m = index % 12 + 1;
        uint dim = _daysInMonth(y, m);
        if (d > dim) d = dim;
        return _daysFromCivil(y, m, d) * SECONDS_PER_DAY + start % SECONDS_PER_DAY;
    }
}
