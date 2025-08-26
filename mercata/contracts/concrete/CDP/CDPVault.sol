import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";

contract record CDPVault is Ownable {
    address public cdpEngine;

    // borrower => asset => balance
    mapping(address => mapping(address => uint)) public userCollaterals;

    event CollateralDeposited(address indexed user, address indexed asset, uint amount);
    event CollateralWithdrawn(address indexed user, address indexed asset, uint amount);
    event CollateralSeized(address indexed borrower, address indexed liquidator, address indexed asset, uint amount);
    event CDPEngineUpdated(
        address indexed oldEngine,
        address indexed newEngine
    );

    modifier onlyEngine() {
        require(msg.sender == cdpEngine, "CDPVault: Only engine");
        _;
    }

    constructor(address _cdpEngine, address initialOwner) Ownable(initialOwner) {
        require(_cdpEngine != address(0), "CDPVault: Invalid engine");
        cdpEngine = _cdpEngine;
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


    function setCDPEngine(address newEngine) external onlyOwner {
        require(newEngine != address(0), "CDPVault: invalid engine");

        address oldEngine = cdpEngine;
        cdpEngine = newEngine;

        emit CDPEngineUpdated(oldEngine, newEngine);
    }
}
