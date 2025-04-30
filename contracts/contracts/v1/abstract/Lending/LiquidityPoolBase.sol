pragma solidvm 12.0;

abstract contract LiquidityPoolBase  {
    event Deposited(address indexed user, address indexed asset, uint256 amount);
    event Withdrawn(address indexed user, address indexed asset, uint256 amount);
    event Borrowed(address indexed user, address indexed asset, uint256 amount);
    event Repaid(address indexed user, address indexed asset, uint256 amount);
    event LendingPoolSet(address lendingPool);

    LendingPoolBase public lendingPool;
    mapping(string => uint256) public record balances;
    mapping(address => uint256) public record totalLiquidity;
    mapping(string => uint256) public record borrowed;

    constructor() {
        
    } 
 
    function setLendingPool(address _lendingPool)  {
        //require(address(lendingPool) == address(0), "LendingPool already set");
        require(_lendingPool != address(0), "Invalid address");
        lendingPool = LendingPoolBase(_lendingPool);
        emit LendingPoolSet(_lendingPool);
    }

    function _key(address user, address asset)  returns (string) {
        return keccak256(string(user), string(asset));
    }

    function deposit(address asset, uint256 amount, address onBehalfOf)   {
        require(amount > 0, "Amount must be greater than 0");
        require(onBehalfOf != address(0), "Invalid user address");
        require(IERC20(asset).transferFrom(onBehalfOf, address(this), amount), "Transfer failed");
        balances[_key(onBehalfOf, asset)] += amount;
        totalLiquidity[asset] += amount;
        emit Deposited(onBehalfOf, asset, amount);
    }

    function withdraw(address asset, uint256 amount, address to)   {
        require(amount > 0, "Amount must be greater than 0");
        require(to != address(0), "Invalid recipient address");
        string key = _key(to, asset);
        require(balances[key] >= amount, "Insufficient balance");
        balances[key] -= amount;
        totalLiquidity[asset] -= amount;
        require(IERC20(asset).transfer(to, amount), "Withdraw failed");
        emit Withdrawn(to, asset, amount);
    }

    function borrow(address asset, uint256 amount, address borrower)   {
        string key = _key(borrower, asset);
        require(amount > 0, "Amount must be greater than 0");
        require(borrower != address(0), "Invalid borrower address");
        require(totalLiquidity[asset] >= amount, "Insufficient liquidity");
        totalLiquidity[asset] -= amount;
        borrowed[key] += amount;
        require(IERC20(asset).transfer(borrower, amount), "Borrow transfer failed");
        emit Borrowed(borrower, asset, amount);
    }

    function repay(address asset, uint256 amount, address borrower)   {
        string key = _key(borrower, asset);
        require(borrowed[key] > 0, "No outstanding debt");
        uint256 repayAmount = amount > borrowed[key] ? borrowed[key] : amount;
        borrowed[key] -= repayAmount;
        require(amount > 0, "Amount must be greater than 0");
        require(borrower != address(0), "Invalid borrower address");
        require(IERC20(asset).transferFrom(borrower, address(this), amount), "Repay failed");
        totalLiquidity[asset] += repayAmount;
        emit Repaid(borrower, asset, repayAmount);
    }

    function getUserBalance(address user, address asset)  view  returns (uint256) {
        return balances[_key(user, asset)];
    }
}