import "./VestingWallet.sol";
import "./CalendarMonths.sol";

// A VestingWallet on the spreadsheet's rule for one allocation category, unlocking
// in whole calendar months from start (TGE). For a total allocation A, the amount
// vested at month m is:
//
//   m <  cliffMonths                    : 0
//   m >= cliffMonths                    : A * cliffUnlockBps / 10000
//                                         + the rest * (m - cliffMonths) / vestingMonths
//   m >= cliffMonths + vestingMonths    : A
//
// duration() and end() are the calendar span of the schedule.
contract record MonthlyVestingWallet is VestingWallet, CalendarMonths {
    string public category;
    uint public cliffMonths;
    uint public cliffUnlockBps;
    uint public vestingMonths;

    constructor(
        string _category,
        address beneficiaryAddress,
        uint64 startTimestamp,
        uint _cliffMonths,
        uint _cliffUnlockBps,
        uint _vestingMonths
    ) VestingWallet(beneficiaryAddress, startTimestamp, uint64(_addMonths(startTimestamp, _cliffMonths + _vestingMonths) - startTimestamp)) {
        require(_cliffUnlockBps <= 10000, "MonthlyVestingWallet: cliff unlock above 100%");
        require(_vestingMonths > 0 || _cliffUnlockBps == 10000, "MonthlyVestingWallet: remainder never vests");
        category = _category;
        cliffMonths = _cliffMonths;
        cliffUnlockBps = _cliffUnlockBps;
        vestingMonths = _vestingMonths;
    }

    // The schedule itself: cumulative vested out of `amount` at month `month`.
    function cumulativeUnlocked(uint amount, uint month) public view returns (uint) {
        if (month < cliffMonths) return 0;
        uint atCliff = amount * cliffUnlockBps / 10000;
        uint elapsed = month - cliffMonths;
        if (elapsed >= vestingMonths) return amount;
        return atCliff + (amount - atCliff) * elapsed / vestingMonths;
    }

    function _vestingSchedule(uint256 totalAllocation, uint64 timestamp) internal view override returns (uint256) {
        if (timestamp < start()) return 0;
        return cumulativeUnlocked(totalAllocation, _monthsBetween(start(), timestamp));
    }
}
