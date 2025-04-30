pragma solidvm 12.0;

abstract contract CollateralVaultBase is IERC20, Ownable {
    event CollateralAdded(address indexed user, address indexed asset, uint256 amount);
    event CollateralRemoved(address indexed user, address indexed asset, uint256 amount);

    address public lendingPool;
    mapping(string => uint256) public record collaterals;

    constructor() Ownable() {
        // Set lendingPool later
    }
    
    function setLendingPool(address _lendingPool) onlyOwner {
        //require(lendingPool == address(0), "LendingPool already set");
        require(_lendingPool != address(0), "Invalid address");
        lendingPool = _lendingPool;
    }

    function _key(address user, address asset)  returns (string) {
        return keccak256(string(user), string(asset));
    }

    function addCollateral(address borrower, address asset, uint256 amount)  {
        require(amount > 0, "Invalid amount");
        require(IERC20(asset).transferFrom(borrower, address(this), amount), "Transfer failed");

        string key = _key(borrower, asset);
        collaterals[key] += amount;

        emit CollateralAdded(borrower, asset, amount);
    }

    function removeCollateral(address borrower, address asset, uint256 amount)  {
        string key = _key(borrower, asset);
        require(collaterals[key] >= amount, "Insufficient collateral");

        collaterals[key] -= amount;
        require(IERC20(asset).transfer(borrower, amount), "Transfer failed");

        emit CollateralRemoved(borrower, asset, amount);
    }

    function getCollateral(address borrower, address asset)  view returns (uint256) {
        return collaterals[_key(borrower, asset)];
    }
}

