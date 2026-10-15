import "./TokenomicsSchedule.sol";

// A multi-year emission stream (the spreadsheet's "Ongoing TVL" and "Bootstrapping
// Emissions" rows). yearlyAmounts[y] is emitted evenly over the 12 months of year
// y + 1, which runs from month 12y + 1 to month 12y + 12 after TGE; nothing is
// emitted at TGE itself. The table may be adjusted during setup (see
// TokenomicsSchedule); once finalized, anyone may release what is due to the
// recipient.
contract record EmissionSchedule is TokenomicsSchedule {
    address public recipient;
    uint[] public yearlyAmounts;
    uint public total;
    uint public released;

    event YearlyAmountsSet(uint total);
    event Released(address indexed recipient, uint amount);

    constructor(
        string _category,
        address _token,
        uint _tgeTimestamp,
        address _recipient,
        uint[] _yearlyAmounts,
        address _setupAdmin
    ) TokenomicsSchedule(_category, _token, _tgeTimestamp, _setupAdmin) {
        require(_recipient != address(0), "EmissionSchedule: recipient is zero");
        recipient = _recipient;
        _setYearlyAmounts(_yearlyAmounts);
    }

    function setYearlyAmounts(uint[] _yearlyAmounts) external onlySetup {
        _setYearlyAmounts(_yearlyAmounts);
    }

    function _setYearlyAmounts(uint[] _yearlyAmounts) internal {
        require(_yearlyAmounts.length > 0, "EmissionSchedule: no years");
        yearlyAmounts.length = 0;
        total = 0;
        for (uint i = 0; i < _yearlyAmounts.length; i++) {
            yearlyAmounts.push(_yearlyAmounts[i]);
            total += _yearlyAmounts[i];
        }
        emit YearlyAmountsSet(total);
    }

    function _required() internal view override returns (uint) {
        return total;
    }

    function yearCount() external view returns (uint) {
        return yearlyAmounts.length;
    }

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

    function unlockedAt(uint timestamp) public view returns (uint) {
        if (timestamp < tgeTimestamp) return 0;
        return cumulativeUnlocked(_monthsBetween(tgeTimestamp, timestamp));
    }

    function releasable() public view returns (uint) {
        return unlockedAt(block.timestamp) - released;
    }

    function release() external onlyFinalized {
        uint amount = releasable();
        require(amount > 0, "EmissionSchedule: nothing to release");
        released += amount;
        _pay(recipient, amount);
        emit Released(recipient, amount);
    }
}
