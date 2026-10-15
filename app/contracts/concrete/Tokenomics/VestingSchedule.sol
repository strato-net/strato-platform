import "./TokenomicsSchedule.sol";

// One tokenomics allocation category (Team, Investors, ...) vesting on the
// spreadsheet's rule. For a grant of `amount`, the cumulative unlocked amount at
// month m after TGE is:
//
//   m <  cliffMonths                    : 0
//   m >= cliffMonths                    : amount * cliffUnlockBps / 10000
//                                         + the rest * (m - cliffMonths) / vestingMonths
//   m >= cliffMonths + vestingMonths    : amount
//
// The setup admin adds grants; see TokenomicsSchedule for the lifecycle. Once
// finalized, no key can add, change, revoke or move a grant; anyone may release
// vested tokens to their beneficiary.
contract record VestingSchedule is TokenomicsSchedule {
    uint public cliffMonths;
    uint public cliffUnlockBps;
    uint public vestingMonths;

    uint public totalGranted;
    uint public totalReleased;
    address[] public beneficiaries;
    mapping(address => uint) public granted;
    mapping(address => uint) public released;

    event GrantAdded(address indexed beneficiary, uint amount);
    event Released(address indexed beneficiary, uint amount);

    constructor(
        string _category,
        address _token,
        uint _tgeTimestamp,
        uint _cliffMonths,
        uint _cliffUnlockBps,
        uint _vestingMonths,
        address _setupAdmin
    ) TokenomicsSchedule(_category, _token, _tgeTimestamp, _setupAdmin) {
        require(_cliffUnlockBps <= 10000, "VestingSchedule: cliff unlock above 100%");
        require(_vestingMonths > 0 || _cliffUnlockBps == 10000, "VestingSchedule: remainder never vests");
        cliffMonths = _cliffMonths;
        cliffUnlockBps = _cliffUnlockBps;
        vestingMonths = _vestingMonths;
    }

    function addGrants(address[] accounts, uint[] amounts) external onlySetup {
        require(accounts.length == amounts.length, "VestingSchedule: length mismatch");
        for (uint i = 0; i < accounts.length; i++) {
            address a = accounts[i];
            uint amount = amounts[i];
            require(a != address(0), "VestingSchedule: beneficiary is zero");
            require(amount > 0, "VestingSchedule: amount is zero");
            require(granted[a] == 0, "VestingSchedule: duplicate beneficiary");
            granted[a] = amount;
            beneficiaries.push(a);
            totalGranted += amount;
            emit GrantAdded(a, amount);
        }
    }

    function _required() internal view override returns (uint) {
        return totalGranted;
    }

    function beneficiaryCount() external view returns (uint) {
        return beneficiaries.length;
    }

    // The schedule itself, independent of any grant: cumulative unlocked out of
    // `amount` at month `month` after TGE.
    function cumulativeUnlocked(uint amount, uint month) public view returns (uint) {
        if (month < cliffMonths) return 0;
        uint atCliff = amount * cliffUnlockBps / 10000;
        uint elapsed = month - cliffMonths;
        if (elapsed >= vestingMonths) return amount;
        return atCliff + (amount - atCliff) * elapsed / vestingMonths;
    }

    function unlockedAt(uint amount, uint timestamp) public view returns (uint) {
        if (timestamp < tgeTimestamp) return 0;
        return cumulativeUnlocked(amount, _monthsBetween(tgeTimestamp, timestamp));
    }

    function vested(address beneficiary) public view returns (uint) {
        return unlockedAt(granted[beneficiary], block.timestamp);
    }

    function releasable(address beneficiary) public view returns (uint) {
        return vested(beneficiary) - released[beneficiary];
    }

    function release(address beneficiary) external onlyFinalized {
        require(_release(beneficiary) > 0, "VestingSchedule: nothing to release");
    }

    // Batch push for large lists (e.g. the airdrop); skips accounts with nothing due.
    function releaseMany(address[] accounts) external onlyFinalized {
        for (uint i = 0; i < accounts.length; i++) {
            _release(accounts[i]);
        }
    }

    function _release(address beneficiary) internal returns (uint) {
        uint amount = releasable(beneficiary);
        if (amount == 0) return 0;
        released[beneficiary] += amount;
        totalReleased += amount;
        _pay(beneficiary, amount);
        emit Released(beneficiary, amount);
        return amount;
    }
}
