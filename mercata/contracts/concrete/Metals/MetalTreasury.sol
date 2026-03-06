import "../../abstract/ERC20/ERC20.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Ownable.sol";

/**
 * @title MetalTreasury
 * @notice Holds stablecoin principal from MetalForge mints until used for off-chain metal purchases.
 * @dev Only the owner (AdminRegistry) can withdraw. Separate from FeeCollector so backing
 *      capital is never co-mingled with protocol revenue.
 */
contract record MetalTreasury is Ownable {
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    constructor(address _owner) Ownable(_owner) {}

    function withdrawToken(address token, address to, uint256 amount) external onlyOwner {
        require(token != address(0), "MetalTreasury: zero token");
        require(to != address(0), "MetalTreasury: zero recipient");
        require(amount > 0, "MetalTreasury: zero amount");
        require(IERC20(token).balanceOf(address(this)) >= amount, "MetalTreasury: insufficient balance");
        require(IERC20(token).transfer(to, amount), "MetalTreasury: transfer failed");
        emit Withdrawn(token, to, amount);
    }
}
