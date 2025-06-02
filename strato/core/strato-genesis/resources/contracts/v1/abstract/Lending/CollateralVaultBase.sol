pragma solidvm 12.0;

abstract contract CollateralVaultBase is IERC20 {
    event CollateralAdded(address indexed user, address indexed asset, uint256 amount);
    event CollateralRemoved(address indexed user, address indexed asset, uint256 amount);
    struct Collateral {   
        address user;
        address asset;
        uint256 amount;
      }
    address public lendingPool;
    mapping(string => Collateral) public record collaterals;

    constructor() {
        // Set lendingPool later
    }
    
    modifier onlyLendingPool() {
        require(msg.sender == lendingPool, "Caller is not LendingPool");
        _;
    }
    
    function setLendingPool(address _lendingPool) external  {
        //require(lendingPool == address(0), "LendingPool already set");
        require(_lendingPool != address(0), "Invalid address");
        lendingPool = _lendingPool;
    }

    function _key(address user, address asset) pure returns (string) {
        return keccak256(string(user), string(asset));
    }

    function addCollateral(address borrower, address asset, uint256 amount) public  onlyLendingPool {
        require(amount > 0, "Invalid amount");
        require(IERC20(asset).transferFrom(borrower, address(this), amount), "Transfer failed");

        string key = _key(borrower, asset);
        Collateral storage collateral = collaterals[key];
        collateral.user = borrower;
        collateral.asset = asset;
        collateral.amount += amount;
        //collaterals[key] += amount;

        emit CollateralAdded(borrower, asset, amount);
    }

    function removeCollateral(address borrower, address asset, uint256 amount) public  onlyLendingPool {
        string key = _key(borrower, asset);
        require(collaterals[key].amount >= amount, "Insufficient collateral");

        collaterals[key].amount -= amount;
        require(IERC20(asset).transfer(borrower, amount), "Transfer failed");

        emit CollateralRemoved(borrower, asset, amount);
    }

    function getCollateral(address borrower, address asset) public view  returns (uint256) {
        return collaterals[_key(borrower, asset)].amount;
    }
}

