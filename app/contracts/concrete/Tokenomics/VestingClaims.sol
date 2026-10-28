import "./MonthlyVestingWallet.sol";

// The beneficiary of one member category (Team, Investors, ...). It creates the
// category's MonthlyVestingWallet with itself as the fixed beneficiary: the wallet
// holds the unvested tokens and the schedule, and this contract splits whatever the
// wallet has vested among the members in proportion to their grants. All members
// share the category's schedule, so each member's share is exactly what the
// schedule has vested of their grant.
//
// Setup phase: the setup admin adds grants, in batches for long lists, while the
// wallet is minted in. finalize() checks the wallet holds every grant and drops the
// setup admin for good. From then on no key can add, change or move a grant; anyone
// may claim for a member, and the tokens always go to that member.
contract record VestingClaims {
    string public category;
    address public token;
    address public wallet;
    address public setupAdmin;
    bool public finalized;

    uint public totalGranted;
    uint public totalClaimed;
    address[] public members;
    mapping(address => uint) public granted;
    mapping(address => uint) public claimed;

    event GrantAdded(address indexed member, uint amount);
    event Finalized(uint totalGranted);
    event Claimed(address indexed member, uint amount);

    constructor(
        string _category,
        address _token,
        uint64 startTimestamp,
        uint _cliffMonths,
        uint _cliffUnlockBps,
        uint _vestingMonths,
        address _setupAdmin
    ) {
        require(_token != address(0), "VestingClaims: token is zero");
        require(_setupAdmin != address(0), "VestingClaims: setup admin is zero");
        category = _category;
        token = _token;
        setupAdmin = _setupAdmin;
        wallet = address(new MonthlyVestingWallet(_category, address(this), startTimestamp, _cliffMonths, _cliffUnlockBps, _vestingMonths));
    }

    modifier onlySetup() {
        require(msg.sender == setupAdmin, "VestingClaims: caller is not setup admin");
        _;
    }

    modifier onlyFinalized() {
        require(finalized, "VestingClaims: not finalized");
        _;
    }

    function addGrants(address[] accounts, uint[] amounts) external onlySetup {
        require(accounts.length == amounts.length, "VestingClaims: length mismatch");
        for (uint i = 0; i < accounts.length; i++) {
            address a = accounts[i];
            uint amount = amounts[i];
            require(a != address(0), "VestingClaims: member is zero");
            require(amount > 0, "VestingClaims: amount is zero");
            require(granted[a] == 0, "VestingClaims: duplicate member");
            granted[a] = amount;
            members.push(a);
            totalGranted += amount;
            emit GrantAdded(a, amount);
        }
    }

    // The wallet's allocation is its balance plus what it has released (as in
    // VestingWallet.vestedAmount). Anything beyond the grants is shared pro rata.
    function finalize() external onlySetup {
        require(totalGranted > 0, "VestingClaims: nothing granted");
        uint allocation = IERC20(token).balanceOf(wallet) + VestingWallet(wallet).released(token);
        require(allocation >= totalGranted, "VestingClaims: wallet underfunded");
        finalized = true;
        setupAdmin = address(0);
        emit Finalized(totalGranted);
    }

    function memberCount() external view returns (uint) {
        return members.length;
    }

    // Everything vested for the members so far: claimed, held here, and still
    // releasable from the wallet.
    function totalVested() public view returns (uint) {
        return totalClaimed + IERC20(token).balanceOf(address(this)) + VestingWallet(wallet).releasable(token);
    }

    function claimable(address member) public view returns (uint) {
        if (!finalized) return 0;
        return totalVested() * granted[member] / totalGranted - claimed[member];
    }

    function claim(address member) external onlyFinalized {
        _pull();
        require(_claim(member) > 0, "VestingClaims: nothing to claim");
    }

    // Batch push for large lists (e.g. the airdrop); skips members with nothing due.
    function claimMany(address[] accounts) external onlyFinalized {
        _pull();
        for (uint i = 0; i < accounts.length; i++) {
            _claim(accounts[i]);
        }
    }

    function _pull() internal {
        if (VestingWallet(wallet).releasable(token) > 0) VestingWallet(wallet).release(token);
    }

    function _claim(address member) internal returns (uint) {
        uint amount = claimable(member);
        if (amount == 0) return 0;
        claimed[member] += amount;
        totalClaimed += amount;
        require(IERC20(token).transfer(member, amount), "VestingClaims: transfer failed");
        emit Claimed(member, amount);
        return amount;
    }
}
