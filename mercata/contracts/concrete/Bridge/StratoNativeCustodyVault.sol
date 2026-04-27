import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";

/**
 * @title StratoNativeCustodyVault
 * @notice Holds locked STRATO-native assets that back external native bridge flows.
 * @notice The bridge contract is the only caller allowed to lock and unlock funds.
 */
contract record StratoNativeCustodyVault is Ownable {
    /// @notice Authorized bridge contract that manages liabilities in this vault.
    address public bridge;
    address public guardian;

    /// @notice Circuit breaker for vault lock/unlock operations.
    bool public paused;

    /// @notice Total amount locked per STRATO token.
    mapping(address => uint256) public record lockedBalance;

    event BridgeUpdated(address indexed previousBridge, address indexed newBridge);
    event PauseToggled(bool paused);
    event Locked(address indexed token, address indexed from, uint256 amount);
    event Unlocked(address indexed token, address indexed to, uint256 amount);

    modifier onlyBridge() {
        require(msg.sender == bridge, "SNCV: not bridge");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "SNCV: paused");
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    function initialize(
        address _bridge,
        address _guardian
    ) external onlyOwner {
        require(_guardian != address(0), "SNCV: zero guardian");
        guardian = _guardian;
        _setBridge(_bridge);
    }

    function setGuardian(address newGuardian) external onlyOwner {
        require(newGuardian != address(0), "SNCV: zero guardian");
        guardian = newGuardian;
    }

    function setBridge(address newBridge) external {
        require(msg.sender == owner(), "SNCV: only owner");
        _setBridge(newBridge);
    }

    function _setBridge(address newBridge) internal {
        require(newBridge != address(0), "SNCV: zero bridge");
        emit BridgeUpdated(bridge, newBridge);
        bridge = newBridge;
    }

    function setPause(bool _paused) external {
        if (_paused) {
            require(
                msg.sender == owner() || msg.sender == guardian,
                "SNCV: not guardian"
            );
        } else {
            require(msg.sender == owner(), "SNCV: only owner unpauses");
        }
        paused = _paused;
        emit PauseToggled(_paused);
    }

    /**
     * @notice Pull funds from a user into custody for a native bridge-out request.
     * @return actualAmount The actual amount received by the vault.
     */
    function lock(
        address token,
        address from,
        uint256 amount
    ) external onlyBridge whenNotPaused returns (uint256 actualAmount) {
        require(token != address(0), "SNCV: invalid token");
        require(from != address(0), "SNCV: invalid from");
        require(amount > 0, "SNCV: zero amount");

        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        require(IERC20(token).transferFrom(from, address(this), amount), "SNCV: transfer failed");
        actualAmount = IERC20(token).balanceOf(address(this)) - balanceBefore;
        require(actualAmount > 0, "SNCV: no tokens received");

        lockedBalance[token] += actualAmount;
        emit Locked(token, from, actualAmount);
    }

    /**
     * @notice Release backed funds to a STRATO recipient after a verified external redemption.
     * @return actualAmount The actual amount transferred to the recipient.
     */
    function unlock(
        address token,
        address to,
        uint256 amount
    ) external onlyBridge whenNotPaused returns (uint256 actualAmount) {
        require(token != address(0), "SNCV: invalid token");
        require(to != address(0), "SNCV: invalid to");
        require(amount > 0, "SNCV: zero amount");
        require(lockedBalance[token] >= amount, "SNCV: insufficient locked");

        uint256 balanceBefore = IERC20(token).balanceOf(to);
        require(IERC20(token).transfer(to, amount), "SNCV: transfer failed");
        actualAmount = IERC20(token).balanceOf(to) - balanceBefore;
        require(actualAmount > 0, "SNCV: no tokens sent");

        lockedBalance[token] -= actualAmount;
        emit Unlocked(token, to, actualAmount);
    }
}
