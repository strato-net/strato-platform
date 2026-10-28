import "./VestingWallet.sol";
import "./CalendarMonths.sol";

// A VestingWallet for a multi-year emission stream (the spreadsheet's "Ongoing TVL"
// and "Bootstrapping Emissions" rows). yearlyAmounts[y] vests evenly over the 12
// months of year y + 1, which runs from month 12y + 1 to month 12y + 12 after start
// (TGE); nothing vests at TGE itself. The table is in tokens; a wallet holding more
// or less than its total vests its holdings in the same proportions.
contract record EmissionVestingWallet is VestingWallet, CalendarMonths {
    string public category;
    uint[] public yearlyAmounts;
    uint public total;

    constructor(
        string _category,
        address beneficiaryAddress,
        uint64 startTimestamp,
        uint[] _yearlyAmounts
    ) VestingWallet(beneficiaryAddress, startTimestamp, uint64(_addMonths(startTimestamp, 12 * _yearlyAmounts.length) - startTimestamp)) {
        require(_yearlyAmounts.length > 0, "EmissionVestingWallet: no years");
        category = _category;
        for (uint i = 0; i < _yearlyAmounts.length; i++) {
            yearlyAmounts.push(_yearlyAmounts[i]);
            total += _yearlyAmounts[i];
        }
        require(total > 0, "EmissionVestingWallet: nothing to emit");
    }

    function yearCount() external view returns (uint) {
        return yearlyAmounts.length;
    }

    // The table itself: cumulative emitted at month `month`.
    function cumulativeUnlocked(uint month) public view returns (uint) {
        if (month == 0) return 0;
        uint year = (month - 1) / 12;
        if (year >= yearlyAmounts.length) return total;
        uint sum = 0;
        for (uint i = 0; i < year; i++) {
            sum += yearlyAmounts[i];
        }
        uint monthsIntoYear = (month - 1) % 12 + 1;
        return sum + yearlyAmounts[year] * monthsIntoYear / 12;
    }

    function _vestingSchedule(uint256 totalAllocation, uint64 timestamp) internal view override returns (uint256) {
        return totalAllocation * cumulativeUnlocked(_monthsBetween(start(), timestamp)) / total;
    }
}
