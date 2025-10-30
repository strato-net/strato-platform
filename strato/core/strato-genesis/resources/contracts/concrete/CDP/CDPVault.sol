/*
 * CDPVault
 * - Custody contract for CDP collateral balances keyed by (user, asset)
 * - No pricing or risk logic; only the CDPEngine may move funds
 * - Emits deposit/withdraw/seize events for auditability
 */

import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "./CDPRegistry.sol";

contract record CDPVault is Ownable {
    CDPRegistry public registry;

    // borrower => asset => balance
    mapping(address => mapping(address => uint)) public userCollaterals;

    event CollateralDeposited(address indexed user, address indexed asset, uint amount);
    event CollateralWithdrawn(address indexed user, address indexed asset, uint amount);
    event CollateralSeized(address indexed borrower, address indexed liquidator, address indexed asset, uint amount);
    event RegistryUpdated(
        address indexed oldRegistry,
        address indexed newRegistry
    );

    modifier onlyEngine() {
        require(msg.sender == address(registry.cdpEngine()), "CDPVault: Only engine");
        _;
    }

    /**
     * @notice Initialize with registry and owner
     */
    constructor(address initialOwner) Ownable(initialOwner) { }

    function initialize(address _registry) external onlyOwner {
        require(_registry != address(0), "CDPVault: Invalid registry");
        registry = CDPRegistry(_registry);
    }

    /**
     * @notice Move collateral from user into vault custody
     * @dev Only CDPEngine may call; pulls tokens from borrower
     */
    function deposit(
        address borrower,
        address asset,
        uint amount
    ) public onlyEngine {
        require(borrower != address(0), "CDPVault: Invalid borrower");
        require(asset != address(0), "CDPVault: Invalid asset");
        require(amount > 0, "Invalid amount");

        require(IERC20(asset).transferFrom(borrower, address(this), amount), "Transfer failed");
        userCollaterals[borrower][asset] += amount;
        emit CollateralDeposited(borrower, asset, amount);
    }

    /**
     * @notice Return collateral from vault to user
     * @dev Only CDPEngine may call; reverts on insufficient balance
     */
    function withdraw(
        address borrower,
        address asset,
        uint amount
    ) public onlyEngine {
        require(
            userCollaterals[borrower][asset] >= amount,
            "CDPVault: Insufficient balance"
        );

        userCollaterals[borrower][asset] -= amount;
        require(IERC20(asset).transfer(borrower, amount), "Transfer failed");
        emit CollateralWithdrawn(borrower, asset, amount);
    }

    /**
     * @notice Transfer collateral to the liquidator during liquidation
     * @dev Only CDPEngine may call; reverts on insufficient balance
     */
    function seize(
        address borrower,
        address asset,
        address liquidator,
        uint amount
    ) public onlyEngine {
        require(amount > 0, "Invalid amount");
        require(
            userCollaterals[borrower][asset] >= amount,
            "CDPVault: insufficient balance"
        );

        userCollaterals[borrower][asset] -= amount;
        require(IERC20(asset).transfer(liquidator, amount), "Transfer failed");

        emit CollateralSeized(borrower, liquidator, asset, amount);
    }

    /**
     * @notice View helper
     */
    function getCollateral(address user, address asset) public view returns (uint) {
        return userCollaterals[user][asset];
    }

    /**
     * @notice Update the registry reference (owner only)
     */
    function setRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "Invalid registry address");
        address oldRegistry = address(registry);
        registry = CDPRegistry(_registry);
        emit RegistryUpdated(oldRegistry, _registry);
    }
}