import "./LendingRegistry.sol";
import "./CollateralVault.sol";
import "./LiquidityPool.sol";
import "./PriceOracle.sol";
import "../Admin/FeeCollector.sol";
import "../Tokens/TokenFactory.sol";

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
 
    event Deposited(address indexed user, address indexed asset, uint amount);
    event Withdrawn(address indexed user, address indexed asset, uint amount);
    event Borrowed(address indexed user, address indexed asset, uint amount);
    event Repaid(address indexed user, address indexed asset, uint amount);
    event Liquidated(address indexed borrower, address indexed asset, uint repaidAmount, address indexed collateralAsset, uint collateralSeized);
    event SuppliedCollateral(address indexed user, address indexed asset, uint amount);
    event WithdrawnCollateral(address indexed user, address indexed asset, uint amount);
    event ExchangeRateUpdated(address indexed asset, uint newRate);
    event AssetConfigured(address indexed asset, uint ltv, uint liquidationThreshold, uint liquidationBonus, uint interestRate, uint reserveFactor);
    event DebtCeilingsUpdated(uint assetUnits, uint usdValue);
    event IndexAccrued(uint oldIndex, uint newIndex, uint dt, uint rateBps, uint interestDelta, uint reservesAccruedAfter);
    event ReservesSwept(uint amount, address to);

    // ═══════════════════════════════════════════════════════════════════════════════
    // DATA STRUCTURES
    // ═══════════════════════════════════════════════════════════════════════════════

    struct LoanInfo {
        uint scaledDebt;     // user debt in index-scaled units
        uint lastUpdated;    // optional metadata
    }

    struct AssetConfig {
        uint ltv;                    // Loan-to-Value ratio (max initial borrow) in basis points
        uint liquidationThreshold;   // Liquidation threshold in basis points  
        uint liquidationBonus;       // Liquidation bonus in basis points
        uint interestRate;          // Interest rate in basis points
        uint reserveFactor;         // Reserve factor in basis points (percentage to protocol treasury)
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════════════════════

    // ── Interest index (global) ───────────────────────────────────────────────────────
    uint public RAY = 1e27;
    uint public SECONDS_PER_YEAR = 31536000;

    uint public borrowIndex;    // global borrow index (init to RAY in constructor)
    uint public lastAccrual;    // last global accrual timestamp
    uint public totalScaledDebt; // sum of all users' scaled debt
    uint public reservesAccrued; // protocol reserves accrued in underlying units

    // ── System-wide debt ceilings ─────────────────────────────────────────────────────
    uint public debtCeilingAsset; // cap in underlying asset units (18d); 0 disables
    uint public debtCeilingUSD;   // cap in USD 1e18; 0 disables

   // Loan Management - One loan per user
    mapping(address => LoanInfo) public record userLoan; // user => single loan

    // Asset Configuration
    mapping(address => AssetConfig) public record assetConfigs;
    
    // Array of all configured assets (for iteration)
    address[] public record configuredAssets;

    // Single Borrowable Asset
    address public borrowableAsset; // The one asset that can be borrowed
    address public mToken; // mToken for the borrowable asset
    
    // External Contracts
    LendingRegistry public registry;
    TokenFactory public tokenFactory;
    address public poolConfigurator;
    FeeCollector public feeCollector;

    // ═══════════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR & MODIFIERS
    // ═══════════════════════════════════════════════════════════════════════════════

    constructor(address _registry, address _poolConfigurator, address initialOwner, address _tokenFactory, address _feeCollector) Ownable(initialOwner) {
        require(_registry != address(0), "Invalid registry address");
        registry = LendingRegistry(_registry);
        require(_poolConfigurator != address(0), "Invalid pool configurator address");
        poolConfigurator = _poolConfigurator;
        tokenFactory = TokenFactory(_tokenFactory);
        feeCollector = FeeCollector(_feeCollector);
        borrowIndex = RAY;
        lastAccrual = uint(block.timestamp);
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
    function depositLiquidity(uint amount) external onlyTokenFactory(borrowableAsset) {
        require(amount > 0, "Invalid amount");
        require(mToken != address(0), "mToken not set");
        
        // Check that borrowable asset has lending parameters configured
        AssetConfig memory config = assetConfigs[borrowableAsset];
        require(config.interestRate > 0, "Interest rate not configured");
    
        _accrue(); // ensure borrow index & reserves are up-to-date before mint calc
        
        // Calculate current exchange rate and corresponding mToken amount to mint
        uint exchangeRate = getExchangeRate();
        uint mTokenAmount = (amount * 1e18) / exchangeRate;
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
    function withdrawLiquidity(uint amount) external onlyTokenFactory(borrowableAsset) {
        require(amount > 0, "Invalid amount");
        require(mToken != address(0), "mToken not set");

        _accrue(); // ensure borrow index & reserves are up-to-date before burn calc
        
        // Calculate mTokens to burn based on current exchange rate
        uint exchangeRate = getExchangeRate();
        // ceilDiv: (a + b - 1) / b
        uint mTokensToBurn = (amount * 1e18 + exchangeRate - 1) / exchangeRate;
        
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
    function supplyCollateral(address asset, uint amount) external onlyTokenFactory(asset) {
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
     */
    function withdrawCollateral(address asset, uint amount) external onlyTokenFactory(asset) {
        require(amount > 0, "Invalid amount");

        uint totalCollateral = CollateralVault(_collateralVault()).userCollaterals(msg.sender, asset);
        require(totalCollateral >= amount, "Insufficient collateral");

        _accrue(); // ensure borrow index & reserves are up-to-date before health check

        // health check to ensure the user remains solvent after withdrawal
        uint currentBorrow = getUserDebt(msg.sender); // underlying units (e.g., USDST 18d)
        uint newMaxBorrow = calculateMaxBorrowingPower(msg.sender, asset, amount); // underlying units
        require(currentBorrow <= newMaxBorrow, "Withdrawal would exceed existing loan");
        
        CollateralVault(_collateralVault()).removeCollateral(msg.sender, asset, amount);

        emit WithdrawnCollateral(msg.sender, asset, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // BORROWING OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
    * @notice Borrow against total collateral supplied
    * @param amount The amount to borrow (underlying units, 18 decimals)
    * @dev Uses global borrow index; enforces system-wide debt ceilings.
    */
    function borrow(uint amount) external onlyTokenFactory(borrowableAsset) {
        require(amount > 0, "Invalid amount");

        // 1) bring index & reserves current, then enforce global caps
        _accrue();
        _checkDebtLimits(amount);

        // 2) user-level collateral check (asset units)
        uint maxBorrowAmount = calculateMaxBorrowingPower(msg.sender, address(0), 0);
        uint currentOwed = getUserDebt(msg.sender); // index-based
        require(currentOwed + amount <= maxBorrowAmount, "Insufficient collateral for borrow");

        // 3) update index-based loan storage
        LoanInfo storage loan = userLoan[msg.sender];
        uint scaledAdd = (amount * RAY) / borrowIndex;
        loan.scaledDebt += scaledAdd;
        loan.lastUpdated = block.timestamp;
        totalScaledDebt += scaledAdd;

        // 4) move funds
        LiquidityPool(_liquidityPool()).borrow(amount, msg.sender);

        // exchange rate reflects: cash ↓, debt ↑ (after _accrue)
        emit ExchangeRateUpdated(borrowableAsset, getExchangeRate());   
        emit Borrowed(msg.sender, borrowableAsset, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // REPAYMENT OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════════════
    /**
    * @notice Repay part or all of the caller’s outstanding debt (index-based)
    * @param amount Repayment amount in underlying units (18 decimals)
    */
    function repay(uint amount) external onlyTokenFactory(borrowableAsset) {
        LoanInfo storage loan = userLoan[msg.sender];
        require(loan.scaledDebt > 0, "No active loan");
        require(amount > 0, "Invalid repayment");

        // Bring index & reserves current
        _accrue();

        // Compute current owed from scaled debt
        uint owed = (loan.scaledDebt * borrowIndex) / RAY;
        require(owed > 0, "Nothing to repay");

        // Clamp to what's owed
        uint repayAmount = amount > owed ? owed : amount;

        // Move funds into the pool
        LiquidityPool(_liquidityPool()).repay(repayAmount, msg.sender);

        // Convert repayAmount to scaled units and reduce debt
        uint scaledDelta = (repayAmount * RAY) / borrowIndex;
        if (scaledDelta > loan.scaledDebt) scaledDelta = loan.scaledDebt; // clamp dust

        loan.scaledDebt -= scaledDelta;
        totalScaledDebt -= scaledDelta;

        if (loan.scaledDebt == 0) {
            delete userLoan[msg.sender];
        } else {
            loan.lastUpdated = block.timestamp;
        }
        // debt ↓ (after _accrue and scaledDebt reduction)
        emit ExchangeRateUpdated(borrowableAsset, getExchangeRate());
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
        uint debtToCover
    ) external onlyTokenFactory(borrowableAsset) {
        require(collateralAsset != address(0), "Invalid collateral asset");
        require(borrower != address(0) && borrower != msg.sender, "Invalid borrower");
        require(debtToCover > 0, "Invalid debt amount");

        // Ensure collateral asset is configured and has liquidation parameters
        AssetConfig memory cConfig = assetConfigs[collateralAsset];
        require(cConfig.liquidationBonus >= 10000, "Asset not eligible for liquidation");

        // NEW: accrue globally and read index-based debt
        _accrue();

        uint totalOwed = getUserDebt(borrower);
        require(totalOwed > 0, "Borrower has no debt");

        uint health = getHealthFactor(borrower); // 1e18 scaled
        require(health < 1e18, "Position healthy");

        // Determine max allowed repayment
        uint maxRepay = (health < 95e16) ? totalOwed : (totalOwed / 2);
        require(debtToCover <= maxRepay, "Repay amount exceeds allowed limit");

        // Collect repayment from liquidator into LiquidityPool
        LiquidityPool(_liquidityPool()).repay(debtToCover, msg.sender);

        // NEW: reduce borrower scaled debt (index-based)
        LoanInfo storage loan = userLoan[borrower];
        uint scaledDelta = (debtToCover * RAY) / borrowIndex;
        if (scaledDelta > loan.scaledDebt) scaledDelta = loan.scaledDebt; // clamp dust
        loan.scaledDebt -= scaledDelta;
        totalScaledDebt -= scaledDelta;

        if (loan.scaledDebt == 0) {
            delete userLoan[borrower];
        } else {
            loan.lastUpdated = block.timestamp;
        }

        // Calculate collateral to seize
        uint priceDebt = PriceOracle(_priceOracle()).getAssetPrice(borrowableAsset); // 18 decimals USD
        uint priceColl = PriceOracle(_priceOracle()).getAssetPrice(collateralAsset);
        require(priceDebt > 0 && priceColl > 0, "Invalid oracle price");

        uint collateralToSeize = (debtToCover * priceDebt * cConfig.liquidationBonus) / (priceColl * 10000);
        // debtToCover and prices are 1e18, so collateralToSeize is in collateral decimals (assume 18)

        // Ensure borrower has enough collateral
        uint borrowerCollateral = CollateralVault(_collateralVault()).userCollaterals(borrower, collateralAsset);
        if (collateralToSeize > borrowerCollateral) {
            collateralToSeize = borrowerCollateral; // seize all remaining
        }

        // Transfer collateral to liquidator
        CollateralVault(_collateralVault()).seizeCollateral(borrower, msg.sender, collateralAsset, collateralToSeize);

        // cash ↑, debt ↓ (after _accrue and debt reduction)
        emit ExchangeRateUpdated(borrowableAsset, getExchangeRate());
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

    // Index-based user debt (public view)
    function getUserDebt(address user) public view returns (uint debt) {
        LoanInfo memory loan = userLoan[user];
        if (loan.scaledDebt == 0) return 0;
        return (loan.scaledDebt * borrowIndex) / RAY;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // HEALTH & RISK CALCULATIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Get user's health factor (Aave style - uses liquidation thresholds)
     * @param user The user address
     * @return Health factor scaled by 1e18 (1.0e18 = 100% = liquidation threshold)
     */
    function getHealthFactor(address user) public view returns (uint) {
        uint totalCollateralValue = _getTotalCollateralValueForHealth(user);
        uint totalBorrowValue = _getTotalBorrowValue(user);
        
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
        uint ltv,
        uint liquidationThreshold,
        uint liquidationBonus,
        uint interestRate,
        uint reserveFactor
    ) external onlyPoolConfigurator {
        require(asset != address(0) && tokenFactory.isTokenActive(asset), "Invalid or inactive asset"); 
        require(ltv <= liquidationThreshold, "LTV must be <= liquidation threshold");
        require(liquidationThreshold <= 9500, "Liquidation threshold too high"); // Max 95%
        require(liquidationBonus >= 10000 && liquidationBonus <= 12500, "Invalid liquidation bonus"); // 100-125%
        require(interestRate <= 10000, "Interest rate too high"); // Max 100%
        require(reserveFactor <= 5000, "Reserve factor too high"); // Max 50%

        _accrue();
        
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
    function getAssetConfig(address asset) external view returns (uint, uint, uint, uint, uint) {
        AssetConfig memory config = assetConfigs[asset];
        return (config.ltv, config.liquidationThreshold, config.liquidationBonus, config.interestRate, config.reserveFactor);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // mToken MANAGEMENT & EXCHANGE RATES
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Get exchange rate for the borrowable asset 
     * @dev mTokens are minted/burned using this rate; it reflects cash + accrued borrower receivable − protocol reserves.
     * @return Exchange rate in 1e18 scale (1e18 = 1 underlying per mToken)
     */
    function getExchangeRate() public view returns (uint) {
        if (mToken == address(0)) return 1e18;

        uint totalSupply_ = IERC20(mToken).totalSupply();
        if (totalSupply_ == 0) {
            return 1e18; // Initial 1:1 ratio
        }

        uint cash = IERC20(borrowableAsset).balanceOf(address(_liquidityPool()));
        uint debt = _totalDebt(); // index-based system debt

        // Suppliers' claimable underlying excludes protocol reserves
        uint underlying = cash + debt;
        if (reservesAccrued < underlying) {
            underlying -= reservesAccrued;
        } else {
            // Extreme guard: if reserves exceed assets (shouldn't happen), floor at cash
            underlying = cash;
        }

        if (underlying == 0) {
            return 1e18; // Fallback to 1:1 if no assets
        }

        return (underlying * 1e18) / totalSupply_;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // INTEREST ACCRUAL & SYSTEM CEILINGS (INTERNALS)
    // ═══════════════════════════════════════════════════════════════════════════════

    /// @notice Returns total system debt in underlying units.
    function _totalDebt() internal view returns (uint) {
        return (totalScaledDebt * borrowIndex) / RAY;
    }

    /// @notice APR (bps) used by `_accrue()` (static per-asset rate).
    function _currentAprBps() internal view returns (uint) {
        return assetConfigs[borrowableAsset].interestRate;
    }

    /// @notice Accrues interest globally into the borrow index and protocol reserves.
    function _accrue() internal {
        uint ts = uint(block.timestamp);
        uint last = lastAccrual;
        if (ts == last) return;

        uint idx0 = borrowIndex;
        uint dt = uint(ts - last);

        uint rateBps = _currentAprBps();
        // factorRAY = (APR * dt / YEAR) in RAY
        uint factorRAY = (rateBps * RAY * dt) / (10000 * SECONDS_PER_YEAR);

        uint idx1 = (idx0 * (RAY + factorRAY)) / RAY;
        borrowIndex = idx1;
        lastAccrual = ts;

        if (totalScaledDebt > 0) {
            uint interestDelta = (totalScaledDebt * (idx1 - idx0)) / RAY;
            uint rf = assetConfigs[borrowableAsset].reserveFactor; // bps
            if (rf > 0 && interestDelta > 0) {
                reservesAccrued += (interestDelta * rf) / 10000;
            }
            emit IndexAccrued(idx0, idx1, dt, rateBps, interestDelta, reservesAccrued);
        }
    }

    /// @notice Enforce system-wide debt ceilings (asset & USD) for a proposed new borrow amount.
    function _checkDebtLimits(uint addAmount) internal view {
        uint newDebt = _totalDebt() + addAmount;

        if (debtCeilingAsset > 0) {
            require(newDebt <= debtCeilingAsset, "Debt ceiling (asset) exceeded");
        }
        if (debtCeilingUSD > 0) {
            uint p = PriceOracle(_priceOracle()).getAssetPrice(borrowableAsset); // 1e18 USD
            require(p > 0, "No oracle price");
            uint newUsd = (newDebt * p) / 1e18;
            require(newUsd <= debtCeilingUSD, "Debt ceiling (USD) exceeded");
        }
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
    /**
     * @notice Set the single borrowable asset
     * @param _asset The asset that can be borrowed
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

    /// @notice Sets system-wide debt ceilings (0 disables a ceiling)
    function setDebtCeilings(uint assetUnits, uint usdValue) external onlyPoolConfigurator {
        debtCeilingAsset = assetUnits;
        debtCeilingUSD = usdValue;
        emit DebtCeilingsUpdated(assetUnits, usdValue);
    }

    /// @notice Sweep protocol reserves to FeeCollector (bounded by cash & reserves)
    function sweepReserves(uint amount) external onlyPoolConfigurator {
        if (amount == 0 || reservesAccrued == 0) return;
        _accrue();
        uint cash = IERC20(borrowableAsset).balanceOf(address(_liquidityPool()));
        uint toSend = amount;
        if (toSend > reservesAccrued) toSend = reservesAccrued;
        if (toSend > cash) toSend = cash;

        if (toSend > 0 && address(feeCollector) != address(0)) {
            LiquidityPool(_liquidityPool()).transferReserve(toSend, address(feeCollector));
            reservesAccrued -= toSend;
            emit ReservesSwept(toSend, address(feeCollector));
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════════════════════

    // @dev Calculate liquidation-weighted collateral value for a user (iterates configuredAssets)
    function _getTotalCollateralValueForHealth(address user) internal view returns (uint) {
        uint totalValue = 0;
        CollateralVault vault = _collateralVault();
        PriceOracle oracle = _priceOracle();
      for (uint i = 0; i < configuredAssets.length; i++) {
            address asset = configuredAssets[i];
            uint collateralAmount = vault.userCollaterals(user, asset);
            if (collateralAmount == 0) continue;

            uint price = oracle.getAssetPrice(asset);
            uint liqThreshold = assetConfigs[asset].liquidationThreshold;
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
    function _getTotalBorrowValue(address user) internal view returns (uint) {
        uint debt = getUserDebt(user); // scaledDebt * borrowIndex / RAY
        if (debt == 0) return 0;

        uint price = PriceOracle(_priceOracle()).getAssetPrice(borrowableAsset); // USD 1e18
        if (price == 0) return 0;

        // USD value (18 decimals)
        return (debt * price) / 1e18;
    }

    /**
     * @notice Calculate maximum borrowing power based on user's collateral
     * @param user The user address
     * @param excludeAsset Asset to exclude from calculation (for withdrawal simulation)
     * @param excludeAmount Amount to exclude from the excluded asset
     * @return maxBorrowAmount Maximum amount user can borrow in borrowableAsset units
     */
    function calculateMaxBorrowingPower(address user, address excludeAsset, uint excludeAmount) public view returns (uint) {
        uint totalCollateralValue = 0;
        
        // Check all configured assets - only count if it's configured as collateral (ltv > 0)
        for (uint i = 0; i < configuredAssets.length; i++) {
            address asset = configuredAssets[i];
            uint ltv = assetConfigs[asset].ltv;
            
            // Only process assets that are configured as collateral
            if (ltv > 0) {
                uint collateralAmount = CollateralVault(_collateralVault()).userCollaterals(user, asset);
                
                // If this is the asset being excluded (for withdrawal simulation), reduce the amount
                if (asset == excludeAsset) {
                    if (collateralAmount >= excludeAmount) {
                        collateralAmount = collateralAmount - excludeAmount;
                    } else {
                        collateralAmount = 0;
                    }
                }
                
                if (collateralAmount > 0) {
                    uint price = PriceOracle(_priceOracle()).getAssetPrice(asset);
                    
                    if (price > 0) {
                        // Calculate borrowable value using LTV (max borrowing power)
                        uint assetBorrowableValue = (collateralAmount * price * ltv) / (1e18 * 10000);
                        totalCollateralValue += assetBorrowableValue;
                    }
                }
            }
        }
        
        // Convert total borrowable value back to borrowableAsset units
        uint borrowableAssetPrice = PriceOracle(_priceOracle()).getAssetPrice(borrowableAsset);
        if (borrowableAssetPrice == 0) {
            return 0;
        }
        
        return (totalCollateralValue * 1e18) / borrowableAssetPrice;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // PREVIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
    * @notice Preview the borrow index as if interest were accrued at the current block timestamp.
    * @dev
    *  - Read-only projection: DOES NOT modify state (no writes to `borrowIndex` or `lastAccrual`).
    *  - Uses simple-interest over elapsed time since `lastAccrual` at the static APR from `assetConfigs[borrowableAsset].interestRate`.
    *  - If `block.timestamp == lastAccrual`, returns the current `borrowIndex` unchanged.
    *  - Units: RAY (1e27).
    * @return projectedIndex The projected borrow index in RAY units.
    */
    function previewBorrowIndex() public view returns (uint projectedIndex) {
        if (block.timestamp == lastAccrual) return borrowIndex;
        uint dt = uint(block.timestamp - lastAccrual);
        uint rateBps = assetConfigs[borrowableAsset].interestRate; // static APR in bps
        uint factorRAY = (rateBps * RAY * dt) / (10000 * SECONDS_PER_YEAR);
        return (borrowIndex * (RAY + factorRAY)) / RAY;
    }

    /**
    * @notice Preview a user's debt using the projected borrow index at the current block timestamp.
    * @dev
    *  - Read-only projection: NO state changes.
    *  - Computes `debt = user.scaledDebt * previewBorrowIndex() / RAY`.
    *  - Units: underlying asset decimals (typically 18).
    *  - The returned value may differ slightly from on-chain results if state changes occur before your tx executes.
    * @param user The account to preview.
    * @return debtPreview The user’s projected debt in underlying units.
    */
    function getUserDebtPreview(address user) public view returns (uint debtPreview) {
        uint idx = previewBorrowIndex();
        return (userLoan[user].scaledDebt * idx) / RAY;
    }

    /**
    * @notice Preview the USD notional of a user's debt at the current block timestamp.
    * @dev
    *  - Read-only projection combining `getUserDebtPreview(user)` with the current oracle price.
    *  - Returns 0 if the user has no debt or if the oracle price is 0.
    *  - Units: 1e18 USD.
    *  - The returned value can change by the time a transaction is mined (e.g., if utilization or prices move).
    * @param user The account to preview.
    * @return usdValuePreview The projected USD value of the user’s debt (1e18).
    */
    function getTotalBorrowValuePreview(address user) public view returns (uint usdValuePreview) {
        uint debt = getUserDebtPreview(user);
        if (debt == 0) return 0;
        uint price = PriceOracle(_priceOracle()).getAssetPrice(borrowableAsset); // 1e18 USD
        if (price == 0) return 0;
        return (debt * price) / 1e18;
    }
} 