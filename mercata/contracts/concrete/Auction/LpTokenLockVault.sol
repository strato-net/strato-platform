import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Ownable.sol";

// Time-locked vault for LP tokens minted at TGE.
// Summary:
// - Locks LP tokens with a 1-year cliff and 2-year vesting.
// - Beneficiary can release vested tokens over time.
contract record LpTokenLockVault is Ownable {
    IERC20 public lpToken;
    address public beneficiary;
    uint public startTime;
    uint public cliffTime;
    uint public durationSeconds;
    uint public totalLocked;
    uint public released;
    bool public initialized;

    // Owner is assigned on deployment (proxy-safe).
    constructor(address initialOwner) Ownable(initialOwner) { }

    // One-time setup of LP token and vesting schedule.
    // Start time is typically the auction TGE time.
    function initialize(address lpToken_, address beneficiary_, uint startTime_) external onlyOwner {
        require(!initialized, "Already initialized");
        require(lpToken_ != address(0), "Invalid LP token");
        require(beneficiary_ != address(0), "Invalid beneficiary");

        lpToken = IERC20(lpToken_);
        beneficiary = beneficiary_;
        startTime = startTime_;
        // 1-year cliff, 2-year linear vesting from start.
        cliffTime = startTime_ + 31536000;
        durationSeconds = 63072000;
        initialized = true;
    }

    // Owner records additional LP tokens locked in this vault.
    function recordLock(uint amount) external onlyOwner {
        require(initialized, "Not initialized");
        require(amount > 0, "Invalid amount");
        require(lpToken.balanceOf(address(this)) >= totalLocked + amount, "LP balance low");
        totalLocked = totalLocked + amount;
    }

    // Amount currently vested and withdrawable by beneficiary.
    function releasable() public view returns (uint) {
        if (!initialized) return 0;
        if (block.timestamp <= cliffTime) return 0;
        if (block.timestamp >= startTime + durationSeconds) {
            return totalLocked - released;
        }

        uint linearDuration = durationSeconds - (cliffTime - startTime);
        uint elapsed = uint(block.timestamp) - cliffTime;
        uint vested = (totalLocked * elapsed) / linearDuration;
        if (vested <= released) return 0;
        return vested - released;
    }

    // Release vested LP tokens to beneficiary.
    function release() external {
        uint amount = releasable();
        require(amount > 0, "Nothing releasable");
        released = released + amount;
        require(lpToken.transfer(beneficiary, amount), "LP transfer failed");
    }
}
