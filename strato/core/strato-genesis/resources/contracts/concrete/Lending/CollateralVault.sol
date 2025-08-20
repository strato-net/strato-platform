import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "./LendingRegistry.sol";

/**
 * @title CollateralVault
 * @notice Holds and tracks collateral for active loans; enforces collateralization requirements.
 * @dev Only callable by LendingPool for adding or removing user collateral.
 */
 
contract record CollateralVault is Ownable {
    event CollateralAdded(address indexed user, address indexed asset, uint amount);
    event CollateralRemoved(address indexed user, address indexed asset, uint amount);

    LendingRegistry public registry;
    
    // user => asset => amount
    mapping(address => mapping(address => uint)) public record userCollaterals;

    constructor(address _registry, address initialOwner) Ownable(initialOwner) {
        require(_registry != address(0), "Invalid registry address");
        registry = LendingRegistry(_registry);
    }

    modifier onlyLendingPool() {
        require(msg.sender == address(registry.lendingPool()), "Caller is not LendingPool");
        _;
    }

    /**
     * @notice Add collateral for a user
     * @param borrower The user address
     * @param asset The collateral asset address
     * @param amount The amount to add
     */
    function addCollateral(address borrower, address asset, uint amount) public onlyLendingPool {
        require(amount > 0, "Invalid amount");
        require(IERC20(asset).transferFrom(borrower, address(this), amount), "Transfer failed");
        userCollaterals[borrower][asset] += amount;
        emit CollateralAdded(borrower, asset, amount);
    }

    /**
     * @notice Remove collateral for a user
     * @param borrower The user address
     * @param asset The collateral asset address
     * @param amount The amount to remove
     */
    function removeCollateral(address borrower, address asset, uint amount) public onlyLendingPool {
        require(userCollaterals[borrower][asset] >= amount, "Insufficient collateral");
        userCollaterals[borrower][asset] -= amount; 
        require(IERC20(asset).transfer(borrower, amount), "Transfer failed");
        emit CollateralRemoved(borrower, asset, amount);
    }

    /**
     * @notice Seize collateral from borrower and send to liquidator
     * @param borrower The borrower whose collateral is being seized
     * @param to The liquidator address receiving the collateral
     * @param asset The collateral asset address
     * @param amount Amount of collateral to seize
     */
    function seizeCollateral(address borrower, address to, address asset, uint amount) public onlyLendingPool {
        require(amount > 0, "Invalid amount");
        require(userCollaterals[borrower][asset] >= amount, "Insufficient collateral to seize");

        userCollaterals[borrower][asset] -= amount;
        require(IERC20(asset).transfer(to, amount), "Collateral transfer failed");

        emit CollateralRemoved(borrower, asset, amount);
    }

    /**
     * @notice Get collateral amount for a specific user and asset
     * @param user The user address
     * @param asset The asset address
     * @return The collateral amount
     */
    function getCollateral(address user, address asset) public view returns (uint) {
        return userCollaterals[user][asset];
    }

    // Setter function for updating the LendingRegistry reference
    function setRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "Invalid registry address");
        registry = LendingRegistry(_registry);
    }
} 