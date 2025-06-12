import "../../abstract/ERC20/access/Ownable.sol";
import "./LendingRegistry.sol";

/**
 * @title CollateralVault
 * @notice Holds and tracks collateral for active loans; enforces collateralization requirements.
 * @dev Only callable by LendingPool for adding or removing user collateral.
 */
 
contract record CollateralVault is IERC20, Ownable {
    event CollateralAdded(address indexed user, address indexed asset, uint256 amount);
    event CollateralRemoved(address indexed user, address indexed asset, uint256 amount);
    struct Collateral {   
        address user;
        address asset;
        uint256 amount;
    }
    LendingRegistry public registry;
    mapping(string => Collateral) public record collaterals;

    constructor(address _registry, address initialOwner) Ownable(initialOwner) {
        require(_registry != address(0), "Invalid registry address");
        registry = LendingRegistry(_registry);
    }

    modifier onlyLendingPool() {
        require(msg.sender == address(registry.lendingPool()), "Caller is not LendingPool");
        _;
    }

    function _key(address user, address asset) pure returns (string) {
        return keccak256(string(user), string(asset));
    }

    function addCollateral(address borrower, address asset, uint256 amount) public onlyLendingPool {
        require(amount > 0, "Invalid amount");
        require(Token(asset).status() == TokenStatus.ACTIVE, "Token not active");
        require(IERC20(asset).transferFrom(borrower, address(this), amount), "Transfer failed");

        string key = _key(borrower, asset);

        Collateral collateral = collaterals[key];
        collateral.user = borrower;
        collateral.asset = asset;
        collateral.amount += amount;

        emit CollateralAdded(borrower, asset, amount);
    }

    function removeCollateral(address borrower, address asset, uint256 amount) public onlyLendingPool {
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
