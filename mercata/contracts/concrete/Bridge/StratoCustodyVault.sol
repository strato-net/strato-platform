import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";

/// @title StratoCustodyVault
/// @notice Holds locked canonical STRATO-native assets (USDST, GOLDST, SILVST)
///         that back external-chain representations. Separates STRATO-side
///         custody from bridge accounting/orchestration in MercataBridge.
///
/// @dev Trust boundary (explicit, not inferred from ownership):
///      - `bridge` is the single on-chain address authorized to call
///        `lock`/`unlock`. In production this is the MercataBridge contract
///        address. The `onlyBridge` modifier enforces that — no other caller,
///        including the governance owner, can move funds through the
///        operational path.
///      - `owner` is governance: sets `bridge`, configures rate limits,
///        pauses, and (if necessary for migration) can sweep stuck balances.
///        Governance cannot arbitrarily lock or unlock locked asset balances.
///
///      Previously the vault used `onlyOwner` for lock/unlock, which was
///      ambiguous: comments claimed the relayer was the caller, but
///      MercataBridge needed to be the owner for its `lock`/`unlock` calls to
///      succeed. The split below removes that ambiguity.
contract record StratoCustodyVault is Ownable {

    // ============ State ============

    /// @notice The MercataBridge contract authorized to call lock/unlock.
    ///         Set by owner (governance) via `setBridge`.
    address public bridge;

    /// @notice Total locked balance per token address.
    mapping(address => uint256) public lockedBalance;

    /// @notice Whether the vault is paused (blocks lock/unlock; governance
    ///         operations like rate-limit changes still work).
    bool public paused;

    // ============ Rate Limiting ============

    struct RateLimit {
        uint256 maxAmount;
        uint256 windowDuration;
        uint256 currentAmount;
        uint256 windowStart;
    }

    /// @notice Per-token rate limits for lock operations.
    mapping(address => RateLimit) public lockRateLimits;

    /// @notice Per-token rate limits for unlock operations.
    mapping(address => RateLimit) public unlockRateLimits;

    // ============ Events ============

    event BridgeUpdated(address indexed oldBridge, address indexed newBridge);
    event Locked(address indexed token, address indexed from, uint256 amount);
    event Unlocked(address indexed token, address indexed to, uint256 amount);
    event Swept(address indexed token, address indexed to, uint256 amount);
    event RateLimitUpdated(string limitType, address indexed token, uint256 maxAmount, uint256 windowDuration);
    event PauseToggled(bool paused);

    // ============ Constructor ============

    constructor(address _owner) Ownable(_owner) {}

    // ============ Modifiers ============

    modifier onlyBridge() {
        require(msg.sender == bridge, "SCV: not bridge");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "SCV: paused");
        _;
    }

    // ============ Governance (Ownable) ============

    /// @notice Set the authorized bridge contract.
    ///         In a healthy deployment this is set once to MercataBridge.
    ///         Changing it is governance-only and non-silent: existing locked
    ///         balances remain, but only the new bridge can subsequently
    ///         unlock.
    function setBridge(address _bridge) external onlyOwner {
        require(_bridge != address(0), "SCV: zero bridge");
        emit BridgeUpdated(bridge, _bridge);
        bridge = _bridge;
    }

    /// @notice Set the rate limit for lock operations on a token.
    function setLockRateLimit(
        address token,
        uint256 maxAmount,
        uint256 windowDuration
    ) external onlyOwner {
        require(maxAmount > 0 && windowDuration > 0, "SCV: invalid rate limit");
        lockRateLimits[token] = RateLimit(maxAmount, windowDuration, 0, block.timestamp);
        emit RateLimitUpdated("lock", token, maxAmount, windowDuration);
    }

    /// @notice Set the rate limit for unlock operations on a token.
    function setUnlockRateLimit(
        address token,
        uint256 maxAmount,
        uint256 windowDuration
    ) external onlyOwner {
        require(maxAmount > 0 && windowDuration > 0, "SCV: invalid rate limit");
        unlockRateLimits[token] = RateLimit(maxAmount, windowDuration, 0, block.timestamp);
        emit RateLimitUpdated("unlock", token, maxAmount, windowDuration);
    }

    /// @notice Pause or unpause lock/unlock operations.
    function setPause(bool _paused) external onlyOwner {
        paused = _paused;
        emit PauseToggled(_paused);
    }

    /// @notice Emergency sweep. Transfers `amount` of `token` from the vault
    ///         to `to` without decrementing lockedBalance. Intended for
    ///         migration/rollback scenarios and should never be used while
    ///         representation tokens remain in circulation on external chains.
    ///         Accounting drift after a sweep must be reconciled off-chain.
    function sweep(address token, address to, uint256 amount) external onlyOwner {
        require(token != address(0), "SCV: invalid token");
        require(to != address(0), "SCV: invalid to");
        require(amount > 0, "SCV: zero amount");
        require(IERC20(token).transfer(to, amount), "SCV: transfer failed");
        emit Swept(token, to, amount);
    }

    // ============ Bridge-authorized Operations ============

    /// @notice Lock STRATO-native tokens into custody.
    ///         Called when a user bridges a native STRATO asset out to an
    ///         external chain. The bridge must have approved this vault to
    ///         spend its escrowed tokens before calling.
    /// @param token  The STRATO-native token address (e.g., USDST, GOLDST, SILVST).
    /// @param from   The address whose tokens are being locked (typically MercataBridge).
    /// @param amount The amount to lock.
    /// @return actualAmount The actual amount locked (handles fee-on-transfer tokens).
    function lock(
        address token,
        address from,
        uint256 amount
    ) external onlyBridge whenNotPaused returns (uint256 actualAmount) {
        require(token != address(0), "SCV: invalid token");
        require(from != address(0), "SCV: invalid from");
        require(amount > 0, "SCV: zero amount");

        _consumeRateLimit(lockRateLimits[token], amount);

        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        require(IERC20(token).transferFrom(from, address(this), amount), "SCV: transfer failed");
        actualAmount = IERC20(token).balanceOf(address(this)) - balanceBefore;
        require(actualAmount > 0, "SCV: no tokens received");

        lockedBalance[token] += actualAmount;

        emit Locked(token, from, actualAmount);
    }

    /// @notice Unlock STRATO-native tokens from custody.
    ///         Called when the relayer has observed & verified a representation
    ///         burn on an external chain and MercataBridge.confirmDeposit has
    ///         routed the native branch to this vault.
    /// @param token  The STRATO-native token address.
    /// @param to     The recipient on STRATO.
    /// @param amount The amount to unlock.
    /// @return actualAmount The actual amount unlocked.
    function unlock(
        address token,
        address to,
        uint256 amount
    ) external onlyBridge whenNotPaused returns (uint256 actualAmount) {
        require(token != address(0), "SCV: invalid token");
        require(to != address(0), "SCV: invalid to");
        require(amount > 0, "SCV: zero amount");
        require(lockedBalance[token] >= amount, "SCV: insufficient locked");

        _consumeRateLimit(unlockRateLimits[token], amount);

        uint256 balanceBefore = IERC20(token).balanceOf(to);
        require(IERC20(token).transfer(to, amount), "SCV: transfer failed");
        actualAmount = IERC20(token).balanceOf(to) - balanceBefore;
        require(actualAmount > 0, "SCV: no tokens sent");

        lockedBalance[token] -= actualAmount;

        emit Unlocked(token, to, actualAmount);
    }

    // ============ Internal ============

    /// @dev Takes `rl` by storage reference so state mutations (currentAmount,
    ///      windowStart) persist across calls.
    function _consumeRateLimit(RateLimit storage rl, uint256 amount) internal {
        // If rate limit not configured, skip (allow all)
        if (rl.maxAmount == 0) return;

        // Reset window if expired
        if (block.timestamp >= rl.windowStart + rl.windowDuration) {
            rl.currentAmount = 0;
            rl.windowStart = block.timestamp;
        }

        require(
            rl.currentAmount + amount <= rl.maxAmount,
            "SCV: rate limit exceeded"
        );
        rl.currentAmount += amount;
    }
}
