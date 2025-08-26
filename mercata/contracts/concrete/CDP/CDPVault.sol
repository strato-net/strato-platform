contract CDPVault {
    using SafeMath for uint256;

    address public cdpEngine;

    // owner => asset => balance
    mapping(address => mapping(address => uint256)) public balances;

    event CollateralMoved(
        address indexed from,
        address indexed to,
        address indexed asset,
        uint256 amount
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

        emit CollateralMoved(address(this), owner, asset, amount);
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

        emit CollateralMoved(owner, address(this), asset, amount);
    }

    function seize(
        address from,
        address to,
        address asset,
        uint256 amount
    ) external onlyEngine {
        require(
            balances[from][asset] >= amount,
            "CDPVault: Insufficient balance"
        );

        balances[from][asset] = balances[from][asset].sub(amount);
        IERC20(asset).transfer(to, amount);

        emit CollateralMoved(from, to, asset, amount);
    }
}
