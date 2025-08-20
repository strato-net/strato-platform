import "./LendingRegistry.sol";
import "./CollateralVault.sol";
import "./RateStrategy.sol";
import "./LiquidityPool.sol";
import "./PriceOracle.sol";
import "../Admin/FeeCollector.sol";

import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";

/**
 * @title LendingPool
 * @notice Core lending logic contract managing deposits, borrows, repayments, and liquidations.
 * @dev Risk parameters are configured by PoolConfigurator; operational functions may be owner-gated.
 */
contract record LendingPool is Ownable {

    // ═══════════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════════

    event Deposited(address indexed user, address indexed asset, uint256 amount);
    event Withdrawn(address indexed user, address indexed asset, uint256 amount);
    event Borrowed(address indexed user, address indexed asset, uint256 amount);
    event Repaid(address indexed user, address indexed asset, uint256 amount);
    event Liquidated(address indexed borrower, address indexed asset, uint256 repaidAmount, address indexed collateralAsset, uint256 collateralSeized);
    event SuppliedCollateral(address indexed user, address indexed asset, uint256 amount);
    event WithdrawnCollateral(address indexed user, address indexed asset, uint256 amount);
    event ExchangeRateUpdated(address indexed asset, uint256 newRate);
    event InterestDistributed(address indexed asset, uint256 totalInterest, uint256 reserveCut, uint256 supplierCut);
    event AssetConfigured(address indexed asset, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 interestRate, uint256 reserveFactor);

    // ═══════════════════════════════════════════════════════════════════════════════
    // DATA STRUCTURES
    // ═══════════════════════════════════════════════════════════════════════════════

    struct LoanInfo {
        uint256 principalBalance;     // Current principal balance (decreases with certain repayment scenarios)
        uint256 interestOwed;         // Unpaid interest based on last interest calculated time
        uint256 lastIntCalculated;    // Last time interest was calculated
        uint256 lastUpdated;          // Last time loan was updated
    }

    struct AssetConfig {
        uint256 ltv;                    // Loan-to-Value ratio (max initial borrow) in basis points
        uint256 liquidationThreshold;   // Liquidation threshold in basis points
        uint256 liquidationBonus;       // Liquidation bonus in basis points
        uint256 interestRate;          // Interest rate in basis points
        uint256 reserveFactor;         // Reserve factor in basis points (percentage to protocol treasury)
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════════════════════

    // Loan Management - One loan per user
    mapping(address => LoanInfo) public record userLoan; // user => single loan

    // Asset Configuration
    mapping(address => AssetConfig) public record assetConfigs;

    // Array of all configured assets (for iteration)
    address[] public record configuredAssets;

    // Single Borrowable Asset
    address public borrowableAsset; // The one asset that can be borrowed
    address public mToken; // mToken for the borrowable asset

    // ───────────────────────────────────────────────────────────────────────────
    // NEW: Aggregate principal tracking so exchange rate reflects outstanding
    // debt.  Increases on borrow, decreases on principal repayment / liquidation.
    // ───────────────────────────────────────────────────────────────────────────
    uint256 public totalBorrowPrincipal;

    // External Contracts
    LendingRegistry public registry;
    TokenFactory public tokenFactory;
    address public poolConfigurator;
    FeeCollector public feeCollector;
    address public rewardsEngine;

    // ═══════════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR & MODIFIERS
    // ═══════════════════════════════════════════════════════════════════════════════

    constructor(address _registry, address _poolConfigurator, address initialOwner, address _tokenFactory, address _feeCollector, address _rewardsEngine) Ownable(initialOwner) {
        require(_registry != address(0), "Invalid registry address");
        registry = LendingRegistry(_registry);
        require(_poolConfigurator != address(0), "Invalid pool configurator address");
        poolConfigurator = _poolConfigurator;
        tokenFactory = TokenFactory(_tokenFactory);
        feeCollector = FeeCollector(_feeCollector);
        rewardsEngine = _rewardsEngine;
    }

    modifier onlyPoolConfigurator() {
        require(msg.sender == address(poolConfigurator), "Caller is not PoolConfigurator");
        _;
    }

    modifier onlyTokenFactory(address token) {
        require(token != address(0) && tokenFactory.isTokenActive(token), "Invalid or inactive token");
        _;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // REGISTRY ACCESS HELPERS
    // ═══════════════════════════════════════════════════════════════════════════════

    function _liquidityPool() internal view returns (LiquidityPool) {
        return registry.liquidityPool();
    }

    function _collateralVault() internal view returns (CollateralVault) {
        return registry.collateralVault();
    }

    function _rateStrategy() internal view returns (RateStrategy) {
        return registry.rateStrategy();
    }

    function _priceOracle() internal view returns (PriceOracle) {
        return registry.priceOracle();
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // LIQUIDITY OPERATIONS (DEPOSITS & WITHDRAWALS)
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Deposit liquidity and receive interest-bearing mTokens
     * @param amount The amount to deposit
     */
    function depositLiquidity(uint256 amount) external onlyTokenFactory(borrowableAsset) {
        require(amount > 0, "Invalid amount");
        require(mToken != address(0), "mToken not set");

        // Check that borrowable asset has lending parameters configured
        AssetConfig memory config = assetConfigs[borrowableAsset];
        require(config.interestRate > 0, "Interest rate not configured");
        require(config.reserveFactor > 0, "Reserve factor not configured");

        // Calculate current exchange rate and corresponding mToken amount to mint
        uint256 exchangeRate = getExchangeRate();
        uint256 mTokenAmount = (amount * 1e18) / exchangeRate;
        require(mTokenAmount > 0, "Deposit too small");

        // Transfer underlying and mint mTokens via LiquidityPool
        LiquidityPool(_liquidityPool()).deposit(amount, mTokenAmount, msg.sender);

        emit ExchangeRateUpdated(borrowableAsset, getExchangeRate());
        emit Deposited(msg.sender, borrowableAsset, amount);
    }

    /**
     * @notice Withdraw liquidity by specifying underlying asset amount
     * @param amount The amount of underlying assets to withdraw
     */
    function withdrawLiquidity(uint256 amount) external onlyTokenFactory(borrowableAsset) {
        require(amount > 0, "Invalid amount");
        require(mToken != address(0), "mToken not set");

        // Calculate mTokens to burn based on current exchange rate
        uint256 exchangeRate = getExchangeRate();
        uint256 mTokensToBurn = (amount * 1e18) / exchangeRate;

        require(IERC20(mToken).balanceOf(msg.sender) >= mTokensToBurn, "Insufficient mToken balance");

        // LiquidityPool burns calculated mTokens and transfers requested underlying amount
        LiquidityPool(_liquidityPool()).withdraw(mTokensToBurn, msg.sender, amount);

        emit ExchangeRateUpdated(borrowableAsset, getExchangeRate());
        emit Withdrawn(msg.sender, borrowableAsset, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // COLLATERAL OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Supply collateral assets to the vault for future borrowing
     * @param asset The collateral asset address
     * @param amount The amount of collateral to supply
     * @dev User must approve CollateralVault to spend their tokens before calling this function
     */
    function supplyCollateral(address asset, uint256 amount) external onlyTokenFactory(asset) {
        require(amount > 0, "Invalid amount");

        // Check that asset is configured as eligible collateral
        AssetConfig memory config = assetConfigs[asset];
        require(config.ltv > 0, "Asset not configured as collateral");
        require(config.liquidationThreshold > 0, "Asset missing liquidation threshold");
        require(config.liquidationBonus >= 10000, "Asset missing liquidation bonus");

        // The CollateralVault will handle the token transfer from msg.sender
        // User must have approved CollateralVault to spend their tokens
        CollateralVault(_collateralVault()).addCollateral(msg.sender, asset, amount);

        emit SuppliedCollateral(msg.sender, asset, amount);
    }

    /**
     * @notice Withdraw collateral assets from the vault (only if user remains healthy)
     * @param asset The collateral asset address
     * @param amount The amount of collateral to withdraw
     * @param collateralAssets Array of all collateral assets to check for health (from off-chain indexing)
     */
    function withdrawCollateral(address asset, uint256 amount) external onlyTokenFactory(asset) {
        require(amount > 0, "Invalid amount");

        uint256 totalCollateral = CollateralVault(_collateralVault()).userCollaterals(msg.sender, asset);
        require(totalCollateral >= amount, "Insufficient collateral");

        // health check to ensure the user remains solvent after withdrawal
        uint256 currentBorrow = _getTotalBorrowValue(msg.sender); // in USD
        uint256 newMaxBorrow = calculateMaxBorrowingPower(msg.sender, asset, amount); // in USD
        require(currentBorrow <= newMaxBorrow, "Withdrawal would exceed existing loan");

        CollateralVault(_collateralVault()).removeCollateral(msg.sender, asset, amount);

        emit WithdrawnCollateral(msg.sender, asset, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // BORROWING OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Borrow against total collateral supplied
     * @param amount The amount to borrow
     * @dev User can only have one active borrow position at a time
     */
    function borrow(uint256 amount) external onlyTokenFactory(borrowableAsset){
        require(amount > 0, "Invalid amount");

        uint256 maxBorrowAmount = calculateMaxBorrowingPower(msg.sender, address(0), 0);

        LoanInfo storage loan = userLoan[msg.sender];
        uint256 interestRate = assetConfigs[borrowableAsset].interestRate;

        // Get up-to-date debt (without mutating state)
        (uint256 accruedInterest, uint256 currentOwed) = _accrueInterest(loan, interestRate);

        require(currentOwed + amount <= maxBorrowAmount, "Insufficient collateral for borrow");

        // Update state after borrow
        loan.principalBalance += amount;
        // Track aggregate outstanding principal for accurate exchange-rate math
        totalBorrowPrincipal += amount;
        loan.interestOwed += accruedInterest;  // Add any accrued interest to interestOwed
        loan.lastIntCalculated = block.timestamp;
        loan.lastUpdated = block.timestamp;

        LiquidityPool(_liquidityPool()).borrow(amount, msg.sender);

        emit Borrowed(msg.sender, borrowableAsset, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // REPAYMENT OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════════════
    function repay(uint256 amount) external onlyTokenFactory(borrowableAsset) {
        LoanInfo storage loan = userLoan[msg.sender];
        require(loan.principalBalance > 0, "No active loan");
        require(amount > 0, "Invalid repayment");

        uint256 interestRate = assetConfigs[borrowableAsset].interestRate;

        // Get up-to-date debt
        (uint256 accruedInterest, uint256 totalOwed) = _accrueInterest(loan, interestRate);
        require(totalOwed > 0, "Nothing to repay");

        // Update interestOwed with newly accrued interest
        loan.interestOwed += accruedInterest;
        uint256 totalInterest = loan.interestOwed;

        // Clamp to total owed
        uint256 repayAmount = amount > totalOwed ? totalOwed : amount;

        // Calculate principal and interest portions of the repayment
        uint256 principalPortion;
        uint256 interestPortion;

        if (repayAmount >= totalOwed) {
            // Full repayment
            principalPortion = loan.principalBalance;
            interestPortion = loan.interestOwed;
        } else {
            // Partial repayment - pay interest first, then principal
            if (repayAmount <= loan.interestOwed) {
                // Payment only covers (part of) interest
                principalPortion = 0;
                interestPortion = repayAmount;
            } else {
                // Payment covers all interest plus some principal
                interestPortion = loan.interestOwed;
                principalPortion = repayAmount - loan.interestOwed;
            }
        }

        // Transfer repayment to LiquidityPool
        LiquidityPool(_liquidityPool()).repay(repayAmount, msg.sender);

        // Distribute the interest portion (transfer reserve cut out of the pool)
        if (interestPortion > 0) {
            distributeInterest(interestPortion);
        }

        if (repayAmount >= totalOwed) {
            //full repayment - close loan
            delete userLoan[msg.sender];
        } else {
            // Partial repayment — update loan state
            loan.principalBalance -= principalPortion;
            loan.interestOwed -= interestPortion;
            loan.lastIntCalculated = block.timestamp;
            loan.lastUpdated = block.timestamp;
        }

        // Adjust aggregate principal tracker
        if (principalPortion > 0) {
            require(totalBorrowPrincipal >= principalPortion, "Principal tracker underflow");
            totalBorrowPrincipal -= principalPortion;
        }

        emit Repaid(msg.sender, borrowableAsset, repayAmount);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // LIQUIDATION OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Liquidate an unhealthy position
     * @param collateralAsset The collateral asset to seize
     * @param borrower The address of the borrower being liquidated
     * @param debtToCover Amount of debt (in borrowableAsset units) the liquidator is repaying
     * Requirements:
     *  - Borrower health factor must be < 1e18 (unsafe)
     *  - If health factor >= 0.95e18, liquidator may repay at most 50% of outstanding debt
     *  - Otherwise liquidator may repay up to 100% of outstanding debt
     */
    function liquidationCall(
        address collateralAsset,
        address borrower,
        uint256 debtToCover
    ) external onlyTokenFactory(borrowableAsset) {
        require(collateralAsset != address(0), "Invalid collateral asset");
        require(borrower != address(0) && borrower != msg.sender, "Invalid borrower");
        require(debtToCover > 0, "Invalid debt amount");

        // Ensure collateral asset is configured and has liquidation parameters
        AssetConfig memory cConfig = assetConfigs[collateralAsset];
        require(cConfig.liquidationBonus >= 10000, "Asset not eligible for liquidation");

        // Fetch loan info & total debt
        LoanInfo storage loan = userLoan[borrower];
        require(loan.principalBalance > 0, "Borrower has no debt");

        uint256 interestRate = assetConfigs[borrowableAsset].interestRate;
        (uint256 accruedInterest, uint256 totalOwed) = _accrueInterest(loan, interestRate);

        uint256 health = getHealthFactor(borrower); // 1e18 scaled
        require(health < 1e18, "Position healthy");

        // Determine max allowed repayment
        uint256 maxRepay;
        if (health < 95e16) { // 0.95 * 1e18
            maxRepay = totalOwed; // full liquidation allowed
        } else {
            maxRepay = totalOwed / 2; // 50%
        }

        require(debtToCover <= maxRepay, "Repay amount exceeds allowed limit");

        // Collect repayment from liquidator into LiquidityPool
        LiquidityPool(_liquidityPool()).repay(debtToCover, msg.sender);

        // Apply repayment to loan (interest first)
        uint256 newInterestOwed = loan.interestOwed + accruedInterest;
        uint256 repaidPrincipal;
        uint256 repaidInterest;

        if (debtToCover <= newInterestOwed) {
            // All goes to interest
            repaidInterest = debtToCover;
            loan.interestOwed = newInterestOwed - debtToCover;
        } else {
            // Pay off all interest, remainder to principal
            repaidInterest = newInterestOwed;
            repaidPrincipal = debtToCover - newInterestOwed;
            loan.interestOwed = 0;
            loan.principalBalance -= repaidPrincipal;
        }

        // Distribute protocol interest cut if any
        if (repaidInterest > 0) {
            distributeInterest(repaidInterest);
        }

        // If loan fully repaid, delete the record
        if (loan.principalBalance == 0 && loan.interestOwed == 0) {
            delete userLoan[borrower];
        } else {
            loan.lastIntCalculated = block.timestamp;
            loan.lastUpdated = block.timestamp;
        }

        // Adjust aggregate principal tracker for the portion of principal actually repaid
        if (repaidPrincipal > 0) {
            require(totalBorrowPrincipal >= repaidPrincipal, "Principal tracker underflow");
            totalBorrowPrincipal -= repaidPrincipal;
        }

        // Calculate collateral to seize
        uint256 priceDebt = PriceOracle(_priceOracle()).getAssetPrice(borrowableAsset); // 18 decimals USD
        uint256 priceColl = PriceOracle(_priceOracle()).getAssetPrice(collateralAsset);
        require(priceDebt > 0 && priceColl > 0, "Invalid oracle price");

        uint256 collateralToSeize = (debtToCover * priceDebt * cConfig.liquidationBonus) / (priceColl * 10000);
        // debtToCover and prices are 1e18, so collateralToSeize is in collateral decimals (assume 18)

        // Ensure borrower has enough collateral
        uint256 borrowerCollateral = CollateralVault(_collateralVault()).userCollaterals(borrower, collateralAsset);
        if (collateralToSeize > borrowerCollateral) {
            collateralToSeize = borrowerCollateral; // seize all remaining
        }

        // Transfer collateral to liquidator
        CollateralVault(_collateralVault()).seizeCollateral(borrower, msg.sender, collateralAsset, collateralToSeize);

        emit Liquidated(borrower, borrowableAsset, debtToCover, collateralAsset, collateralToSeize);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Get user's active loan information
     * @param user The user address
     * @return loan The user's active loan (asset will be address(0) if no active loan)
     */
    function getUserLoan(address user) external view returns (LoanInfo memory loan) {
        return userLoan[user];
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // HEALTH & RISK CALCULATIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Get user's health factor (Aave style - uses liquidation thresholds)
     * @param user The user address
     * @param collateralAssets Array of collateral assets to check (from off-chain indexing)
     * @return Health factor scaled by 1e18 (1.0e18 = 100% = liquidation threshold)
     */
    function getHealthFactor(address user) public view returns (uint256) {
        uint256 totalCollateralValue = _getTotalCollateralValueForHealth(user);
        uint256 totalBorrowValue = _getTotalBorrowValue(user);

        if (totalBorrowValue == 0) return 2**256 - 1; // No debt = infinite health
        if (totalCollateralValue == 0) return 0; // No collateral = 0 health

        // Aave style: health factor = (collateral * liquidation_threshold) / debt
        return (totalCollateralValue * 1e18) / totalBorrowValue;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // ASSET CONFIGURATION & MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Configure asset parameters (Aave style)
     * @param asset The asset address
     * @param ltv Loan-to-Value ratio in basis points (e.g., 7500 = 75%)
     * @param liquidationThreshold Liquidation threshold in basis points (e.g., 8000 = 80%)
     * @param liquidationBonus Liquidation bonus in basis points (e.g., 500 = 5%)
     * @param interestRate Interest rate in basis points (e.g., 500 = 5%)
     * @param reserveFactor Reserve factor in basis points (e.g., 1000 = 10%)
     */
    function configureAsset(
        address asset,
        uint256 ltv,
        uint256 liquidationThreshold,
        uint256 liquidationBonus,
        uint256 interestRate,
        uint256 reserveFactor
    ) external onlyPoolConfigurator {
        require(asset != address(0) && tokenFactory.isTokenActive(asset), "Invalid or inactive asset");
        require(ltv <= liquidationThreshold, "LTV must be <= liquidation threshold");
        require(liquidationThreshold <= 9500, "Liquidation threshold too high"); // Max 95%
        require(liquidationBonus >= 10000 && liquidationBonus <= 12500, "Invalid liquidation bonus"); // 100-125%
        require(interestRate <= 10000, "Interest rate too high"); // Max 100%
        require(reserveFactor <= 5000, "Reserve factor too high"); // Max 50%

        // If this is a new asset, add it to configuredAssets array
        if (assetConfigs[asset].ltv == 0 && assetConfigs[asset].liquidationThreshold == 0) {
            configuredAssets.push(asset);
        }

        assetConfigs[asset] = AssetConfig(
            ltv,
            liquidationThreshold,
            liquidationBonus,
            interestRate,
            reserveFactor
        );

        emit AssetConfigured(asset, ltv, liquidationThreshold, liquidationBonus, interestRate, reserveFactor);
    }

    /**
     * @notice Get asset configuration
     * @param asset The asset address
     * @return ltv, liquidationThreshold, liquidationBonus, interestRate, reserveFactor
     */
    function getAssetConfig(address asset) external view returns (uint256, uint256, uint256, uint256, uint256) {
        AssetConfig memory config = assetConfigs[asset];
        return (config.ltv, config.liquidationThreshold, config.liquidationBonus, config.interestRate, config.reserveFactor);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // mToken MANAGEMENT & EXCHANGE RATES
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Get exchange rate for the borrowable asset
     * @dev In this model, mTokens are always minted 1:1 with deposits
     * @dev The exchange rate shows how much underlying each mToken is worth
     * @return Exchange rate in 18 decimals (1e18 = 1:1 ratio, >1e18 = appreciation)
     */
    function getExchangeRate() public view returns (uint256) {
        if (mToken == address(0)) return 1e18;

        uint256 totalSupply_ = IERC20(mToken).totalSupply();
        if (totalSupply_ == 0) {
            return 1e18; // Initial 1:1 ratio
        }

        uint256 cash = IERC20(borrowableAsset).balanceOf(address(_liquidityPool()));

        // Include outstanding principal so the rate never dips below 1 when cash is lent out
        uint256 underlying = cash + totalBorrowPrincipal;

        if (underlying == 0) {
            return 1e18; // Fallback to 1:1 if no underlying/cash
        }

        // Exchange rate = (cash + outstanding principal) / total mToken supply
        return (underlying * 1e18) / totalSupply_;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // INTEREST DISTRIBUTION
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Distribute interest from borrower repayments
     * @param totalInterest Total interest amount to distribute
     */
    function distributeInterest(uint256 totalInterest) internal onlyTokenFactory(borrowableAsset){
        if (totalInterest == 0) return;

        uint256 assetReserveFactor = assetConfigs[borrowableAsset].reserveFactor;
        if (assetReserveFactor == 0) assetReserveFactor = 1000; // Default 10%

        // Calculate reserve cut (to protocol treasury)
        uint256 reserveCut = (totalInterest * assetReserveFactor) / 10000;
        uint256 supplierCut = totalInterest - reserveCut;

        // The full repayment (including interest) is already in the LiquidityPool
        // We need to transfer the reserve cut out to the fee collector
        // The remaining amount stays in the pool and increases the exchange rate

        if (reserveCut > 0 && address(feeCollector) != address(0)) {
            // Transfer reserve cut directly from LiquidityPool to fee collector
            LiquidityPool liquidityPool = _liquidityPool();
            liquidityPool.transferReserve(reserveCut, address(feeCollector));
        }

        emit InterestDistributed(borrowableAsset, totalInterest, reserveCut, supplierCut);
        emit ExchangeRateUpdated(borrowableAsset, getExchangeRate());
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // ADMINISTRATIVE FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    function setTokenFactory(address _tokenFactory) external onlyPoolConfigurator {
        tokenFactory = TokenFactory(_tokenFactory);
    }

    function setFeeCollector(address _feeCollector) external onlyPoolConfigurator {
        feeCollector = FeeCollector(_feeCollector);
    }

    function setRewardsEngine(address _rewardsEngine) external onlyPoolConfigurator {
        rewardsEngine = _rewardsEngine;
    }
    /**
     * @notice Set the single borrowable asset
     * @param asset The asset that can be borrowed
     */
    function setBorrowableAsset(address _asset) external onlyPoolConfigurator {
        require(_asset != address(0) && tokenFactory.isTokenActive(_asset), "Invalid or inactive asset");
        borrowableAsset = _asset;
    }
    /**
     * @notice Set mToken for the single borrowable asset
     * @param _mToken The mToken for the asset that can be borrowed
     */
    function setMToken(address _mToken) external onlyPoolConfigurator {
        require(_mToken != address(0) && tokenFactory.isTokenActive(_mToken), "Invalid or inactive mToken");
        mToken = _mToken;
        // Update mToken in the LiquidityPool as well
        LiquidityPool(_liquidityPool()).setMToken(_mToken);
    }

     // Setter function for updating the LendingRegistry reference
    function setRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "Invalid registry address");
        registry = LendingRegistry(_registry);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════════════════════
    /**
    * @notice Calculates interest accrued since last update using RateStrategy
    * @param loan The user's loan data
    * @param interestRate The annual interest rate in basis points
    * @return accruedInterest The newly accrued interest
    * @return newTotalOwed current outstanding + accrued interest
    */
    function _accrueInterest(LoanInfo memory loan, uint256 interestRate) internal view returns (uint256 accruedInterest, uint256 newTotalOwed) {
        if (loan.principalBalance == 0) return (0, 0);

        accruedInterest = RateStrategy(_rateStrategy()).calculateInterest(
            loan.principalBalance,
            interestRate,
            loan.lastIntCalculated
        );

        newTotalOwed = loan.principalBalance + loan.interestOwed + accruedInterest;
        return (accruedInterest, newTotalOwed);
    }

    // @dev Calculate liquidation-weighted collateral value for a user (iterates configuredAssets)
    function _getTotalCollateralValueForHealth(address user) internal view returns (uint256) {
        uint256 totalValue = 0;
        for (uint256 i = 0; i < configuredAssets.length; i++) {
            address asset = configuredAssets[i];
            uint256 collateralAmount = CollateralVault(_collateralVault()).userCollaterals(user, asset);
            if (collateralAmount == 0) continue;

            uint256 price = PriceOracle(_priceOracle()).getAssetPrice(asset);
            uint256 liqThreshold = assetConfigs[asset].liquidationThreshold;
            if (price == 0 || liqThreshold == 0) continue;

            totalValue += (collateralAmount * price * liqThreshold) / (1e18 * 10000);
        }
        return totalValue;
    }

    /**
     * @notice Calculate total borrow value for a user (single loan)
     * @param user The user address
     * @return Total borrow value in USD (18 decimals)
     */
    function _getTotalBorrowValue(address user) internal view returns (uint256) {
        LoanInfo memory loan = userLoan[user];
        if (loan.principalBalance == 0) return 0;

        uint256 interestRate = assetConfigs[borrowableAsset].interestRate;

        // Simulate interest accrual
        (, uint256 totalOwed) = _accrueInterest(loan, interestRate);
        if (totalOwed == 0) return 0;

        uint256 price = PriceOracle(_priceOracle()).getAssetPrice(borrowableAsset);
        if (price == 0) return 0;

        // Return USD value (18 decimals)
        return (totalOwed * price) / 1e18;
    }

    /**
     * @notice Calculate maximum borrowing power based on user's collateral
     * @param user The user address
     * @param excludeAsset Asset to exclude from calculation (for withdrawal simulation)
     * @param excludeAmount Amount to exclude from the excluded asset
     * @return maxBorrowAmount Maximum amount user can borrow in borrowableAsset units
     */
    function calculateMaxBorrowingPower(address user, address excludeAsset, uint256 excludeAmount) public view returns (uint256) {
        uint256 totalCollateralValue = 0;

        // Check all configured assets - only count if it's configured as collateral (ltv > 0)
        for (uint256 i = 0; i < configuredAssets.length; i++) {
            address asset = configuredAssets[i];
            uint256 ltv = assetConfigs[asset].ltv;

            // Only process assets that are configured as collateral
            if (ltv > 0) {
                uint256 collateralAmount = CollateralVault(_collateralVault()).userCollaterals(user, asset);

                // If this is the asset being excluded (for withdrawal simulation), reduce the amount
                if (asset == excludeAsset) {
                    if (collateralAmount >= excludeAmount) {
                        collateralAmount = collateralAmount - excludeAmount;
                    } else {
                        collateralAmount = 0;
                    }
                }

                if (collateralAmount > 0) {
                    uint256 price = PriceOracle(_priceOracle()).getAssetPrice(asset);

                    if (price > 0) {
                        // Calculate borrowable value using LTV (max borrowing power)
                        uint256 assetBorrowableValue = (collateralAmount * price * ltv) / (1e18 * 10000);
                        totalCollateralValue += assetBorrowableValue;
                    }
                }
            }
        }

        // Convert total borrowable value back to borrowableAsset units
        uint256 borrowableAssetPrice = PriceOracle(_priceOracle()).getAssetPrice(borrowableAsset);
        if (borrowableAssetPrice == 0) {
            return 0;
        }

        return (totalCollateralValue * 1e18) / borrowableAssetPrice;
    }
}
