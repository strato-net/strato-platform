import "./LendingRegistry.sol";
import "../../abstract/ERC20/access/Ownable.sol";

/**
 * @title LiquidityPool
 * @notice Manages token liquidity for lending and borrowing, including ERC20 token transfers.
 * @dev Only callable by LendingPool; holds deposited funds and tracks borrowed balances.
 */

 contract record LiquidityPool is IERC20, Ownable  {
    event Deposited(address indexed user, address indexed asset, uint256 amount);
    event Withdrawn(address indexed user, address indexed asset, uint256 amount);
    event Borrowed(address indexed user, address indexed asset, uint256 amount);
    event Repaid(address indexed user, address indexed asset, uint256 amount);

    struct Deposit {   
        address user;
        address asset;
        uint256 amount;
    }
    struct Borrow {   
        address user;
        address asset;
        uint256 amount;
    }
    LendingRegistry public registry;
    mapping(string => Deposit) public record deposited;
    mapping(address => uint256) public record totalLiquidity;
    mapping(string => Borrow) public record borrowed;

    constructor(address _registry, address initialOwner) Ownable(initialOwner) {
        require(_registry != address(0), "Invalid registry");
        registry = LendingRegistry(_registry);
    }

    modifier onlyLendingPool() {
        require(msg.sender == address(registry.lendingPool()), "Caller is not LendingPool");
        _;
    }	

    function _key(address user, address asset) pure returns (string) {
        return keccak256(string(user), string(asset));
    }

    function deposit(address asset, uint256 amount, address onBehalfOf) public onlyLendingPool {
        string key = _key(onBehalfOf, asset);
        require(amount > 0, "Amount must be greater than 0");
        require(onBehalfOf != address(0), "Invalid user address");
        require(IERC20(asset).transferFrom(onBehalfOf, address(this), amount), "Transfer failed");
        deposited[key].amount += amount;
        deposited[key].user = onBehalfOf;
        deposited[key].asset = asset;

        totalLiquidity[asset] += amount;
        emit Deposited(onBehalfOf, asset, amount);
    }

    function withdraw(address asset, uint256 amount, address to) public onlyLendingPool {
        require(amount > 0, "Amount must be greater than 0");
        require(to != address(0), "Invalid recipient address");
        string key = _key(to, asset);
        require(deposited[key].amount >= amount, "Insufficient balance");
        deposited[key].amount -= amount;
        totalLiquidity[asset] -= amount;
        require(IERC20(asset).transfer(to, amount), "Withdraw failed");
        emit Withdrawn(to, asset, amount);
    }

    function borrow(address asset, uint256 amount, address borrower) public onlyLendingPool {
        string key = _key(borrower, asset);
        require(amount > 0, "Amount must be greater than 0");
        require(borrower != address(0), "Invalid borrower address");
        require(totalLiquidity[asset] >= amount, "Insufficient liquidity");
        totalLiquidity[asset] -= amount;
        borrowed[key].amount += amount;
        borrowed[key].user = borrower;
        borrowed[key].asset = asset;
        require(IERC20(asset).transfer(borrower, amount), "Borrow transfer failed");
        emit Borrowed(borrower, asset, amount);
    }

    function repay(address asset, uint256 amount, uint256 totalOwed, address borrower) public onlyLendingPool {
        require(amount > 0, "Amount must be greater than 0");
        require(borrower != address(0), "Invalid borrower address");
        string key = _key(borrower, asset);
        //set to latest owed amount that includes interest
        borrowed[key].amount = totalOwed;
        require(borrowed[key].amount > 0, "No outstanding debt");
        uint256 repayAmount = amount > totalOwed ? totalOwed : amount;
        borrowed[key].amount -= repayAmount;
        require(IERC20(asset).transferFrom(borrower, address(this), amount), "Repay failed");
        totalLiquidity[asset] += repayAmount;
        emit Repaid(borrower, asset, repayAmount);
    }

    function getUserBalance(address user, address asset)  view  returns (uint256) public view {
        return deposited[_key(user, asset)].amount;
    }
}