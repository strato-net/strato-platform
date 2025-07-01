import "./LendingRegistry.sol";
import "../Tokens/Token.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";

/**
 * @title LiquidityPool
 * @notice Manages liquidity and mToken minting/burning for a single borrowable asset.
 * @dev Interacts only with LendingPool; the borrowable asset is fetched from LendingPool dynamically.
 */

contract record LiquidityPool is Ownable  {
    event Deposited(address indexed user, uint256 amount, uint256 mTokenMinted);
    event Withdrawn(address indexed user, uint256 amount, uint256 mTokenBurned);
    event Borrowed(address indexed user, uint256 amount);
    event Repaid(address indexed user, uint256 amount);

    LendingRegistry public registry;
    Token public mToken;

    // Restrict to only LendingPool (verified through the registry)
    modifier onlyLendingPool() {
        require(msg.sender == address(registry.lendingPool()), "Caller is not LendingPool");
        _;
    }

    constructor(address _registry, address _owner) Ownable(_owner) {
        require(_registry != address(0), "Invalid registry");
        registry = LendingRegistry(_registry);
    }

    /**
     * @notice Get current underlying asset address
     */
    function _getAsset() internal view returns (address) {
        return LendingPool(registry.lendingPool()).borrowableAsset();
    }

    /**
     * @notice Get current underlying balance
     */
    function getUnderlyingBalance() external view returns (uint256) {
        address asset = _getAsset();
        return IERC20(asset).balanceOf(address(this));
    }

    /**
     * @notice Deposit underlying asset into the pool
     * @param amount Amount of underlying asset to deposit
     * @param user Recipient of the minted mTokens
     */
    function deposit(uint256 amount, address user) external onlyLendingPool {
        require(amount > 0 && user != address(0), "Invalid deposit");
        require(address(mToken) != address(0), "mToken not set");

        address asset = _getAsset();

        // Pull funds from user
        require(IERC20(asset).transferFrom(user, address(this), amount), "Transfer failed");

        // Mint mTokens 1:1 with deposits 
        mToken.mint(user, amount);

        emit Deposited(user, amount, amount);
    }

    /**
     * @notice Withdraw underlying by burning mTokens
     * @param mTokenAmount Amount of mTokens to burn
     * @param user Recipient of underlying asset
     * @param underlyingAmount Exact amount of underlying asset to transfer
     */
    function withdraw(uint256 mTokenAmount, address user, uint256 underlyingAmount) external onlyLendingPool {
        require(mTokenAmount > 0 && user != address(0), "Invalid withdrawal");
        require(underlyingAmount > 0, "Invalid underlying amount");
        require(address(mToken) != address(0), "mToken not set");

        address asset = _getAsset();
        uint256 currentBalance = IERC20(asset).balanceOf(address(this));
        require(currentBalance >= underlyingAmount, "Insufficient liquidity");

        // Burn mTokens from user first
        mToken.burn(user, mTokenAmount);

        // Transfer exact underlying amount to user
        require(IERC20(asset).transfer(user, underlyingAmount), "Withdraw failed");

        emit Withdrawn(user, underlyingAmount, mTokenAmount);
    }

    /**
     * @notice Borrow underlying asset
     * @param amount Amount to borrow
     * @param borrower Address receiving the funds
     */
    function borrow(uint256 amount, address borrower) external onlyLendingPool {
        require(amount > 0 && borrower != address(0), "Invalid borrow");

        address asset = _getAsset();
        uint256 currentBalance = IERC20(asset).balanceOf(address(this));
        require(currentBalance >= amount, "Insufficient liquidity");

        // Transfer underlying to borrower
        require(IERC20(asset).transfer(borrower, amount), "Borrow transfer failed");

        emit Borrowed(borrower, amount);
    }

    /**
     * @notice Repay borrowed funds
     * @param amount Amount to repay
     * @param borrower Payer of the repayment
     */
    function repay(uint256 amount, address borrower) external onlyLendingPool {
        require(amount > 0 && borrower != address(0), "Invalid repayment");

        address asset = _getAsset();

        // Pull repayment funds from user
        require(IERC20(asset).transferFrom(borrower, address(this), amount), "Repay failed");

        emit Repaid(borrower, amount);
    }

    /**
     * @notice Transfer reserve fees to fee collector
     * @param reserveAmount Amount to transfer as reserve fees
     * @param feeCollector Address to receive the reserve fees
     */
    function transferReserve(uint256 reserveAmount, address feeCollector) external onlyLendingPool {
        require(reserveAmount > 0 && feeCollector != address(0), "Invalid reserve transfer");
        
        address asset = _getAsset();
        uint256 currentBalance = IERC20(asset).balanceOf(address(this));
        require(currentBalance >= reserveAmount, "Insufficient liquidity to transfer to reserve");
        
        // Transfer reserve to fee collector
        require(IERC20(asset).transfer(feeCollector, reserveAmount), "Reserve transfer failed");
    }

    /**
     * @notice Set mToken address (only callable by LendingPool)
     */
    function setMToken(address _mToken) external onlyLendingPool {
        require(_mToken != address(0), "Invalid mToken");
        mToken = Token(_mToken);
    }

    /**
     * @notice Allows owner to update the registry (for upgradeability)
     */
    function setRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "Invalid registry address");
        registry = LendingRegistry(_registry);
    }
} 