import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Ownable.sol";

contract record LpTokenLockVault is Ownable {
    IERC20 public lpToken;
    address public beneficiary;
    uint public startTime;
    uint public cliffTime;
    uint public durationSeconds;
    uint public totalLocked;
    uint public released;
    bool public initialized;

    constructor(address initialOwner) Ownable(initialOwner) { }

    function initialize(address lpToken_, address beneficiary_, uint startTime_) external onlyOwner {
        require(!initialized, "Already initialized");
        require(lpToken_ != address(0), "Invalid LP token");
        require(beneficiary_ != address(0), "Invalid beneficiary");

        lpToken = IERC20(lpToken_);
        beneficiary = beneficiary_;
        startTime = startTime_;
        cliffTime = startTime_ + 31536000;
        durationSeconds = 63072000;
        initialized = true;
    }

    function recordLock(uint amount) external onlyOwner {
        require(initialized, "Not initialized");
        require(amount > 0, "Invalid amount");
        require(lpToken.balanceOf(address(this)) >= totalLocked + amount, "LP balance low");
        totalLocked = totalLocked + amount;
    }

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

    function release() external {
        uint amount = releasable();
        require(amount > 0, "Nothing releasable");
        released = released + amount;
        require(lpToken.transfer(beneficiary, amount), "LP transfer failed");
    }
}
