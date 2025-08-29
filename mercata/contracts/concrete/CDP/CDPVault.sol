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

    constructor(address _registry, address initialOwner) Ownable(initialOwner) {
        require(_registry != address(0), "CDPVault: Invalid registry");
        registry = CDPRegistry(_registry);
    }

    function deposit(
        address borrower,
        address asset,
        uint256 amount
    ) public onlyEngine {
        require(borrower != address(0), "CDPVault: Invalid borrower");
        require(asset != address(0), "CDPVault: Invalid asset");
        require(amount > 0, "Invalid amount");

        require(IERC20(asset).transferFrom(borrower, address(this), amount), "Transfer failed");
        userCollaterals[borrower][asset] += amount;
        emit CollateralDeposited(borrower, asset, amount);
    }

    function withdraw(
        address borrower,
        address asset,
        uint256 amount
    ) public onlyEngine {
        require(
            userCollaterals[borrower][asset] >= amount,
            "CDPVault: Insufficient balance"
        );

        userCollaterals[borrower][asset] -= amount;
        require(IERC20(asset).transfer(borrower, amount), "Transfer failed");
        emit CollateralWithdrawn(borrower, asset, amount);
    }

    function seize(
        address borrower,
        address asset,
        address liquidator,
        uint256 amount
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

    function getCollateral(address user, address asset) public view returns (uint) {
        return userCollaterals[user][asset];
    }

    // Setter function for updating the CDPRegistry reference
    function setRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "Invalid registry address");
        address oldRegistry = address(registry);
        registry = CDPRegistry(_registry);
        emit RegistryUpdated(oldRegistry, _registry);
    }
}
