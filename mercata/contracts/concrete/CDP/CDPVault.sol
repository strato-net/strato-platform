contract CDPVault is Ownable {
    using SafeMath for uint256;

    //todo: add ReentrancyGuard

    address public cdpEngine;

    // owner => asset => balance
    mapping(address => mapping(address => uint256)) public balances;

    event CollateralMoved(
        address indexed from,
        address indexed to,
        address indexed asset,
        uint256 amount
    );
    event CDPEngineUpdated(
        address indexed oldEngine,
        address indexed newEngine
    );

    modifier onlyEngine() {
        require(msg.sender == cdpEngine, "CDPVault: Only engine");
        _;
    }

    constructor(address _cdpEngine) {
        require(_cdpEngine != address(0), "CDPVault: Invalid engine");
        cdpEngine = _cdpEngine;
    }

    function deposit(
        address owner,
        address asset,
        uint256 amount
    ) external onlyEngine {
        require(owner != address(0), "CDPVault: Invalid owner");
        require(asset != address(0), "CDPVault: Invalid asset");

        IERC20(asset).transferFrom(owner, address(this), amount);
        balances[owner][asset] = balances[owner][asset].add(amount);

        emit CollateralMoved(owner, address(this), asset, amount);
    }

    function withdraw(
        address owner,
        address asset,
        uint256 amount
    ) external onlyEngine {
        require(
            balances[owner][asset] >= amount,
            "CDPVault: Insufficient balance"
        );

        balances[owner][asset] = balances[owner][asset].sub(amount);
        IERC20(asset).transfer(owner, amount);

        emit CollateralMoved(address(this), owner, asset, amount);
    }

    function seize(
        address borrower,
        address asset,
        address liquidator,
        uint256 amount
    ) external onlyEngine {
        require(
            balances[borrower][asset] >= amount,
            "CDPVault: insufficient balance"
        );

        balances[borrower][asset] -= amount;
        IERC20(asset).safeTransfer(liquidator, amount);

        emit CollateralMoved(borrower, liquidator, asset, amount);
    }

    function emergencyRecover(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner {
        require(to != address(0), "CDPVault: invalid recipient");
        IERC20(token).safeTransfer(to, amount);
    }

    function setCDPEngine(address newEngine) external onlyOwner {
        require(newEngine != address(0), "CDPVault: invalid engine");

        address oldEngine = cdpEngine;
        cdpEngine = newEngine;

        emit CDPEngineUpdated(oldEngine, newEngine);
    }
}
