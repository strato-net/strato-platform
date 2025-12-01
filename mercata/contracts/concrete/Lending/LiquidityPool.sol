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
    event Deposited(address indexed user, uint amount, uint mTokenMinted);
    event Withdrawn(address indexed user, uint amount, uint mTokenBurned);
    event Borrowed(address indexed user, uint amount);
    event Repaid(address indexed user, uint amount);

    LendingRegistry public registry;
    Token public mToken;

    // Restrict to only LendingPool (verified through the registry)
    modifier onlyLendingPool() {
        require(msg.sender == address(registry.lendingPool()), "Caller is not LendingPool");
        _;
    }

    constructor(address _owner) Ownable(_owner) { }

    function initialize(address _registry) external onlyOwner {
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
    function getUnderlyingBalance() external view returns (uint) {
        address asset = _getAsset();
        return IERC20(asset).balanceOf(address(this));
    }

    /**
     * @notice Deposit underlying asset and mint interest-bearing mTokens based on current exchange rate
     * @param amount       Amount of underlying asset the user is supplying
     * @param mintAmount   Number of mTokens that should be minted for the user (calculated in LendingPool)
     * @param user         Recipient of the minted mTokens
     */
    function deposit(uint amount, uint mintAmount, address user) external onlyLendingPool {
        require(amount > 0 && mintAmount > 0 && user != address(0), "Invalid deposit");
        require(address(mToken) != address(0), "mToken not set");

        address asset = _getAsset();

        // Pull funds from the user into the pool
        require(IERC20(asset).transferFrom(user, address(this), amount), "Transfer failed");

        // Mint calculated amount of mTokens to the user
        mToken.mint(user, mintAmount);

        emit Deposited(user, amount, mintAmount);
    }

    /**
     * @notice Withdraw underlying by burning mTokens
     * @param mTokenAmount Amount of mTokens to burn
     * @param user Recipient of underlying asset
     * @param underlyingAmount Exact amount of underlying asset to transfer
     */
    function withdraw(uint mTokenAmount, address user, uint underlyingAmount) external onlyLendingPool {
        require(mTokenAmount > 0 && user != address(0), "Invalid withdrawal");
        require(underlyingAmount > 0, "Invalid underlying amount");
        require(address(mToken) != address(0), "mToken not set");

        address asset = _getAsset();
        uint currentBalance = IERC20(asset).balanceOf(address(this));
        // Do not pay out protocol reserves: only cash minus reserves is withdrawable
        uint reserves = LendingPool(registry.lendingPool()).reservesAccrued();
        uint cashForLPs = currentBalance > reserves ? currentBalance - reserves : 0;
        require(underlyingAmount <= cashForLPs, "Insufficient liquidity (excl reserves)");

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
    function borrow(uint amount, address borrower) external onlyLendingPool {
        require(amount > 0 && borrower != address(0), "Invalid borrow");

        address asset = _getAsset();
        uint currentBalance = IERC20(asset).balanceOf(address(this));
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
    function repay(uint amount, address borrower) external onlyLendingPool {
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
    function transferReserve(uint reserveAmount, address feeCollector) external onlyLendingPool {
        require(reserveAmount > 0 && feeCollector != address(0), "Invalid reserve transfer");

        address asset = _getAsset();
        uint currentBalance = IERC20(asset).balanceOf(address(this));
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