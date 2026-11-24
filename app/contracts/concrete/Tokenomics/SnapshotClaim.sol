import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Ownable.sol";

// A one-off airdrop of fixed amounts, each claimable in full for a limited time.
//
// The loader uploads the allocations in batches and then closes loading for good. The owner,
// the multisig that funds the airdrop, checks the closed list against the published manifest,
// funds this contract and seals it with the total and count it checked. From the seal anyone
// may claim an account's allocation, always paid to that account, until the deadline; after it
// anyone may sweep what is left to the unclaimed recipient. Once loading is closed nobody, the
// owner included, can change an allocation or take tokens out before the deadline.
contract SnapshotClaim is Ownable {
    address public immutable token;
    address public immutable loader;
    address public immutable unclaimedRecipient;
    uint256 public immutable claimWindow;

    mapping(address => uint256) public record allocation;
    mapping(address => bool) public record claimed;
    uint256 public totalAllocated;
    uint256 public allocationCount;
    uint256 public totalClaimed;
    bool public loadingClosed;
    uint256 public deadline; // 0 until sealed

    event AllocationSet(address indexed account, uint256 amount);
    event LoadingClosed(uint256 count, uint256 total);
    event Sealed(uint256 total, uint256 count, uint256 deadline);
    event Claimed(address indexed account, uint256 amount, address indexed by);
    event Swept(address indexed to, uint256 amount);

    constructor(address _token, address _loader, address _unclaimedRecipient, uint256 _claimWindow, address initialOwner) Ownable(initialOwner) {
        require(_token != address(0) && _loader != address(0) && _unclaimedRecipient != address(0), "SC: zero address");
        require(_claimWindow > 0, "SC: no claim window");
        token = _token;
        loader = _loader;
        unclaimedRecipient = _unclaimedRecipient;
        claimWindow = _claimWindow;
    }

    // Sets (never adds) each account's allocation, so a batch sent twice changes nothing; an
    // amount of 0 removes the account.
    function setAllocations(address[] calldata accounts, uint256[] calldata amounts) external {
        require(msg.sender == loader, "SC: loader only");
        require(!loadingClosed, "SC: loading closed");
        require(accounts.length > 0 && accounts.length == amounts.length, "SC: bad batch");
        for (uint256 i = 0; i < accounts.length; i++) {
            address account = accounts[i];
            require(account != address(0), "SC: zero account");
            // `+ 0` reads an unwritten slot as the value 0 (see StratoStaking._notePending).
            uint256 previous = allocation[account] + 0;
            uint256 amount = amounts[i] + 0;
            if (previous == 0 && amount > 0) allocationCount += 1;
            if (previous > 0 && amount == 0) allocationCount -= 1;
            totalAllocated = totalAllocated - previous + amount;
            allocation[account] = amount;
            emit AllocationSet(account, amount);
        }
    }

    function closeLoading() external {
        require(msg.sender == loader, "SC: loader only");
        require(!loadingClosed, "SC: loading closed");
        loadingClosed = true;
        emit LoadingClosed(allocationCount, totalAllocated);
    }

    // The owner seals with the total and count it checked against the manifest. Holding more
    // than the total is fine, so a stray transfer cannot block the seal; the excess leaves with
    // the sweep after the deadline.
    function seal(uint256 expectedTotal, uint256 expectedCount) external onlyOwner {
        require(loadingClosed, "SC: loading open");
        require(deadline == 0, "SC: sealed");
        require(totalAllocated > 0, "SC: nothing allocated");
        require(expectedTotal == totalAllocated && expectedCount == allocationCount, "SC: manifest mismatch");
        require(IERC20(token).balanceOf(address(this)) >= totalAllocated, "SC: underfunded");
        deadline = block.timestamp + claimWindow;
        emit Sealed(totalAllocated, allocationCount, deadline);
    }

    function claim() external {
        _claim(msg.sender);
    }

    // Anyone may claim for an account, for example a relayer paying the gas; the tokens always
    // go to the account.
    function claimFor(address account) external {
        _claim(account);
    }

    function _claim(address account) internal {
        require(deadline != 0, "SC: not sealed");
        require(block.timestamp < deadline, "SC: claim window over");
        require(!claimed[account], "SC: already claimed");
        uint256 amount = allocation[account] + 0;
        require(amount > 0, "SC: nothing to claim");
        claimed[account] = true;
        totalClaimed += amount;
        require(IERC20(token).transfer(account, amount), "SC: transfer failed");
        emit Claimed(account, amount, msg.sender);
    }

    function claimable(address account) external view returns (uint256) {
        if (deadline == 0 || block.timestamp >= deadline || claimed[account]) return 0;
        return allocation[account];
    }

    // After the deadline anyone may send everything left, unclaimed allocations and any excess,
    // to the unclaimed recipient.
    function sweepExpired() external {
        require(deadline != 0 && block.timestamp >= deadline, "SC: claim window open");
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "SC: nothing to sweep");
        require(IERC20(token).transfer(unclaimedRecipient, balance), "SC: transfer failed");
        emit Swept(unclaimedRecipient, balance);
    }
}
