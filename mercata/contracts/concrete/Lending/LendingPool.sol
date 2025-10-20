import "./LendingRegistry.sol";
import "./CollateralVault.sol";
import "./LiquidityPool.sol";
import "./PriceOracle.sol";
import "./SafetyModule.sol";
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
    event AssetConfigured(address indexed asset, uint ltv, uint liquidationThreshold, uint liquidationBonus, uint interestRate, uint reserveFactor, uint perSecondFactorRAY);
    event DebtCeilingsUpdated(uint assetUnits, uint usdValue);
    event IndexAccrued(uint oldIndex, uint newIndex, uint dt, uint rateBps, uint interestDelta, uint reservesAccruedAfter);
    event ReservesSweptTreasury(uint amount, address to);
    event ReservesSweptSafety(uint amount, address to);
    event BadDebtRecognized(uint amount);     // global, no borrower index
    event BadDebtCovered(uint cover, uint remainingBadDebt);
    event BadDebtWrittenOffFromReserves(uint writeOff, uint badDebt, uint reservesAccrued);
    event DepositorHaircutApplied(uint writeOff, uint badDebt, string calldata reason);

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
        uint perSecondFactorRAY;    // Optional per-second compound factor in RAY (1e27). 0 = disabled
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

    // ── Shortfall / bad debt (global only)
    uint public badDebt;                      // base units of borrowableAsset

    // ── System-wide debt ceilings ─────────────────────────────────────────────────────
    uint public debtCeilingAsset; // cap in underlying asset units (18d); 0 disables
    uint public debtCeilingUSD;   // cap in USD 1e18; 0 disables

    uint  public safetyShareBps;      // % of reserves to SM on sweep, e.g. 2000 = 20%

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
    SafetyModule public safetyModule;

    // ═══════════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR & MODIFIERS
    // ═══════════════════════════════════════════════════════════════════════════════

    constructor(address initialOwner) Ownable(initialOwner) { }

    function initialize(address _registry, address _poolConfigurator, address _tokenFactory, address _feeCollector, address _safetyModule) external onlyOwner {
        // @dev important: must be set here for proxied instances; ensure consistency with desired initial values
        RAY = 1e27;
        SECONDS_PER_YEAR = 31536000;
        
        require(_registry != address(0), "Invalid registry address");
        registry = LendingRegistry(_registry);
        require(_poolConfigurator != address(0), "Invalid pool configurator address");
        poolConfigurator = _poolConfigurator;
        tokenFactory = TokenFactory(_tokenFactory);
        feeCollector = FeeCollector(_feeCollector);
        safetyModule = SafetyModule(_safetyModule);
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
    // FIXED-POINT HELPERS (RAY MATH)
    // ═══════════════════════════════════════════════════════════════════════════════

    // Exponentiation by squaring for RAY base. Returns (x^n) with base b.
    function rpow(uint x, uint n, uint b) internal pure returns (uint z) {
        z = b;
        if (n == 0) return z;
        uint y = x;
        while (n > 0) {
            if (n % 2 == 1) {
                // z = z * y / b
                z = (z * y) / b;
            }
            n /= 2;
            if (n > 0) {
                // y = y * y / b
                y = (y * y) / b;
            }
        }
        return z;
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

        // 1) bring index & reserves current
        _accrue();

        // 2) compute mTokens to mint from exchange rate
        uint exchangeRate = getExchangeRate();
        require(exchangeRate > 0, "Invalid rate");
        uint mTokenAmount = (amount * 1e18) / exchangeRate;
        require(mTokenAmount > 0, "Mint calc");

        // 3) move funds & mint
        LiquidityPool(_liquidityPool()).deposit(amount, mTokenAmount, msg.sender);

        // cash ↑ (after deposit)
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
        uint scaledAdd = (amount * RAY + borrowIndex - 1) / borrowIndex;
        require(scaledAdd > 0, "Insufficient loan amount");
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

        // Convert repayAmount to scaled units
        uint scaledDelta = (repayAmount * RAY) / borrowIndex;

        // If partial, prove this will burn at least 1 scaled unit (avoid donation)
        if (repayAmount < owed) {
            require(scaledDelta > 0, "Insufficient repayment amount");
        }

        // Move funds into the pool
        LiquidityPool(_liquidityPool()).repay(repayAmount, msg.sender);

        // Reduce debt
        if (scaledDelta > loan.scaledDebt) scaledDelta = loan.scaledDebt; // clamp dust

        loan.scaledDebt -= scaledDelta;
        totalScaledDebt -= scaledDelta;

        // Dust cleanup: if residual underlying owed is <= 1 wei, zero out
        uint owedAfter = (loan.scaledDebt * borrowIndex) / RAY;
        if (owedAfter <= 1) {
            if (loan.scaledDebt > 0) {
                totalScaledDebt -= loan.scaledDebt;
                loan.scaledDebt = 0;
            }
            delete userLoan[msg.sender];
        } else {
            loan.lastUpdated = block.timestamp;
        }
        // debt ↓ (after _accrue and scaledDebt reduction)
        emit ExchangeRateUpdated(borrowableAsset, getExchangeRate());
        emit Repaid(msg.sender, borrowableAsset, repayAmount);
    }

    /**
     * @notice Borrow the maximum amount allowed by current collateral (minus 1 wei safety)
     * @return amountBorrowed The amount actually borrowed
     */
    function borrowMax() external onlyTokenFactory(borrowableAsset) returns (uint amountBorrowed) {
        // Bring index & reserves current, then enforce system caps on the final amount
        _accrue();

        uint maxBorrowAmount = calculateMaxBorrowingPower(msg.sender, address(0), 0);
        uint currentOwed = getUserDebt(msg.sender);
        require(maxBorrowAmount > currentOwed, "No borrowing power");

        uint available = maxBorrowAmount - currentOwed;
        // 1 wei safety to keep HF strictly > 1 after rounding
        amountBorrowed = available > 1 ? (available - 1) : 0;
        require(amountBorrowed > 0, "No borrowing power");

        _checkDebtLimits(amountBorrowed);

        // Update index-based loan storage
        LoanInfo storage loan = userLoan[msg.sender];
        uint scaledAdd = (amountBorrowed * RAY + borrowIndex - 1) / borrowIndex;
        require(scaledAdd > 0, "Insufficient loan amount");
        loan.scaledDebt += scaledAdd;
        loan.lastUpdated = block.timestamp;
        totalScaledDebt += scaledAdd;

        // Move funds
        LiquidityPool(_liquidityPool()).borrow(amountBorrowed, msg.sender);

        emit ExchangeRateUpdated(borrowableAsset, getExchangeRate());
        emit Borrowed(msg.sender, borrowableAsset, amountBorrowed);
        return amountBorrowed;
    }

    /**
     * @notice Repay the caller's entire outstanding debt
     * @return amountRepaid The amount actually repaid
     */
    function repayAll() external onlyTokenFactory(borrowableAsset) returns (uint amountRepaid) {
        LoanInfo storage loan = userLoan[msg.sender];
        require(loan.scaledDebt > 0, "No active loan");

        _accrue();

        uint owed = (loan.scaledDebt * borrowIndex) / RAY;
        require(owed > 0, "Nothing to repay");

        // Move exact owed into the pool
        LiquidityPool(_liquidityPool()).repay(owed, msg.sender);
        amountRepaid = owed;

        // Reduce scaled debt fully (eliminate dust)
        uint scaledDelta = (amountRepaid * RAY) / borrowIndex;
        if (scaledDelta > loan.scaledDebt) {
            scaledDelta = loan.scaledDebt;
        } else if (scaledDelta < loan.scaledDebt) {
            // Force full zero by consuming any residual due to truncation
            uint remaining = loan.scaledDebt - scaledDelta;
            scaledDelta += remaining;
        }
        loan.scaledDebt -= scaledDelta; // zero
        totalScaledDebt -= scaledDelta;

        if (loan.scaledDebt == 0) {
            delete userLoan[msg.sender];
        } else {
            loan.lastUpdated = block.timestamp;
        }

        emit ExchangeRateUpdated(borrowableAsset, getExchangeRate());
        emit Repaid(msg.sender, borrowableAsset, amountRepaid);
        return amountRepaid;
    }

    /**
     * @notice Withdraw all supplied liquidity by burning the caller's entire mToken balance
     * @dev Burns 100% of caller's mTokens and transfers the corresponding underlying based on current exchange rate
     */
    function withdrawLiquidityAll() external onlyTokenFactory(borrowableAsset) {
        _accrue();
        require(mToken != address(0), "mToken not set");
        uint userShares = IERC20(mToken).balanceOf(msg.sender);
        require(userShares > 0, "No mTokens to withdraw");

        // Underlying amount based on current exchange rate
        uint exchangeRate = getExchangeRate();
        uint underlyingAmount = (userShares * exchangeRate) / 1e18;

        // Ensure pool has liquidity
        address asset = borrowableAsset;
        uint poolCash = IERC20(asset).balanceOf(address(_liquidityPool()));
        require(poolCash >= underlyingAmount, "Insufficient liquidity");

        LiquidityPool(_liquidityPool()).withdraw(userShares, msg.sender, underlyingAmount);
        emit ExchangeRateUpdated(borrowableAsset, getExchangeRate());
    }

    /**
     * @notice Withdraw the maximum collateral for an asset while remaining healthy (minus 1 wei safety)
     * @param asset The collateral asset to withdraw
     * @return amountWithdrawn The amount actually withdrawn
     */
        function withdrawCollateralMax(address asset) external onlyTokenFactory(asset) returns (uint amountWithdrawn) {
         // Current user collateral for asset
         uint totalCollateral = CollateralVault(_collateralVault()).userCollaterals(msg.sender, asset);
         require(totalCollateral > 0, "No collateral");

         _accrue();

         // Current borrow capacity and debt
         uint maxBorrowAmount = calculateMaxBorrowingPower(msg.sender, address(0), 0);
         uint currentOwed = getUserDebt(msg.sender);

         // If no outstanding debt, allow full withdrawal with no dust
         if (currentOwed == 0) {
             CollateralVault(_collateralVault()).removeCollateral(msg.sender, asset, totalCollateral);
             emit WithdrawnCollateral(msg.sender, asset, totalCollateral);
             return totalCollateral;
         }
         require(maxBorrowAmount > currentOwed, "No room");

         // Prices and LTV
         uint priceAsset = PriceOracle(_priceOracle()).getAssetPrice(asset); // 1e18
         uint priceBorrow = PriceOracle(_priceOracle()).getAssetPrice(borrowableAsset); // 1e18
         uint ltv = assetConfigs[asset].ltv; // bps
         require(priceAsset > 0 && priceBorrow > 0 && ltv > 0, "Config");

         // roomBorrow = maxBorrowAmount - currentOwed (in borrowable units)
         uint roomBorrow = maxBorrowAmount - currentOwed;

         // From calculateMaxBorrowingPower math, the reduction in borrow capacity for withdrawing `amount` is:
         // deltaBorrow = amount * priceAsset * ltv / (priceBorrow * 10000)
         // Solve for amount: amount = roomBorrow * priceBorrow * 10000 / (priceAsset * ltv)
         uint numerator = roomBorrow * priceBorrow * 10000;
         uint denom = priceAsset * ltv;
         if (denom == 0) {
             return 0;
         }
         uint maxByHealth = numerator / denom;

         // Cap by user's available collateral
         amountWithdrawn = maxByHealth < totalCollateral ? maxByHealth : totalCollateral;
         // 1 wei safety when there is outstanding debt
         if (amountWithdrawn > 1) {
             amountWithdrawn = amountWithdrawn - 1;
         }
         require(amountWithdrawn > 0, "No withdrawable amount");

         // Final health check using existing path for consistency
         uint newMaxBorrow = calculateMaxBorrowingPower(msg.sender, asset, amountWithdrawn);
         require(currentOwed <= newMaxBorrow, "Withdrawal would exceed existing loan");

         CollateralVault(_collateralVault()).removeCollateral(msg.sender, asset, amountWithdrawn);
         emit WithdrawnCollateral(msg.sender, asset, amountWithdrawn);
         return amountWithdrawn;
     }

    // ═══════════════════════════════════════════════════════════════════════════════
    // LIQUIDATION OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
    * @notice Liquidate an unhealthy position
    * @param collateralAsset The collateral asset to seize
    * @param borrower The address of the borrower being liquidated
    * @param debtToCover Amount of debt (in borrowableAsset units) the liquidator is repaying
    * @param minCollateralOut Minimum collateral amount to receive (slippage protection). Transaction reverts if actual collateral is less.
    * Requirements:
    *  - Borrower health factor must be < 1e18 (unsafe)
    *  - If health factor >= 0.95e18, liquidator may repay at most 50% of outstanding debt
    *  - Otherwise liquidator may repay up to 100% of outstanding debt
    */
    function liquidationCall(
        address collateralAsset,
        address borrower,
        uint debtToCover,
        uint minCollateralOut
    ) public onlyTokenFactory(borrowableAsset) {
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

        // Enforce minimum collateral out requested from user
        require(collateralToSeize > 0, "There is no collateral to seize");
        require(collateralToSeize >= minCollateralOut, "Remaining collateral is less than minimum requested by user");

        // Prove this will burn at least 1 scaled unit (avoid donation)
        LoanInfo storage loan = userLoan[borrower];
        uint scaledDelta = (debtToCover * RAY) / borrowIndex;
        require(scaledDelta > 0, "Insufficient repayment amount");

        // Collect repayment from liquidator into LiquidityPool
        LiquidityPool(_liquidityPool()).repay(debtToCover, msg.sender);

        // NEW: reduce borrower scaled debt (index-based)
        if (scaledDelta > loan.scaledDebt) scaledDelta = loan.scaledDebt; // clamp dust
        loan.scaledDebt -= scaledDelta;
        totalScaledDebt -= scaledDelta;

        // Dust cleanup
        uint owedAfterL = (loan.scaledDebt * borrowIndex) / RAY;
        if (owedAfterL <= 1) {
            if (loan.scaledDebt > 0) {
                totalScaledDebt -= loan.scaledDebt;
                loan.scaledDebt = 0;
            }
            delete userLoan[borrower];
        } else {
            loan.lastUpdated = block.timestamp;
        }

        // Transfer collateral to liquidator
        CollateralVault(_collateralVault()).seizeCollateral(borrower, msg.sender, collateralAsset, collateralToSeize);

            // If no collateral remains and loan still has debt → recognize it as bad debt
        if (_getTotalCollateralValueForHealth(borrower) == 0) {
            LoanInfo storage ln = userLoan[borrower];
            uint scaled = ln.scaledDebt;
            if (scaled > 0) {
                uint baseBad = (scaled * borrowIndex) / RAY; // convert to base

                // Stop interest accrual on this chunk
                totalScaledDebt -= scaled;

                // Zero the user loan
                ln.scaledDebt = 0;
                delete userLoan[borrower];

                // Bump global bad debt
                badDebt += baseBad;

                emit BadDebtRecognized(baseBad);
            }
        }

        // cash ↑, debt ↓ (after _accrue and debt reduction)
        emit ExchangeRateUpdated(borrowableAsset, getExchangeRate());
        emit Liquidated(borrower, borrowableAsset, debtToCover, collateralAsset, collateralToSeize);
    }

    /**
     * @notice Helper to liquidate using the maximum allowable amount at execution time.
     *         Computes repay amount as min(currentDebt, close-factor limit, and collateral coverage)
     *         to avoid overpaying when collateral cannot cover more.
     * @param collateralAsset The collateral asset to seize
     * @param borrower The address of the borrower being liquidated
     * @param minCollateralOut Minimum collateral amount to receive (slippage protection). Transaction reverts if actual collateral is less.
     */
    function liquidationCallAll(
        address collateralAsset,
        address borrower,
        uint minCollateralOut
    ) external onlyTokenFactory(borrowableAsset) {
        require(collateralAsset != address(0), "Invalid collateral asset");
        require(borrower != address(0) && borrower != msg.sender, "Invalid borrower");

        // Ensure collateral asset is configured and has liquidation parameters
        AssetConfig memory cConfig = assetConfigs[collateralAsset];
        require(cConfig.liquidationBonus >= 10000, "Asset not eligible for liquidation");

        // Accrue and read current debt and health
        _accrue();
        uint totalOwed = getUserDebt(borrower);
        require(totalOwed > 0, "Borrower has no debt");
        uint health = getHealthFactor(borrower);
        require(health < 1e18, "Position healthy");

        // Close factor cap
        uint maxRepay = (health < 95e16) ? totalOwed : (totalOwed / 2);

        // Coverage cap = borrowerCollateral * priceColl / (priceDebt * bonus)
        uint priceDebt = PriceOracle(_priceOracle()).getAssetPrice(borrowableAsset);
        uint priceColl = PriceOracle(_priceOracle()).getAssetPrice(collateralAsset);
        require(priceDebt > 0 && priceColl > 0, "Invalid oracle price");
        uint borrowerCollateral = CollateralVault(_collateralVault()).userCollaterals(borrower, collateralAsset);
        uint num = borrowerCollateral * priceColl * 10000;
        uint den = priceDebt * cConfig.liquidationBonus;
        uint coverage = (num + den - 1) / den; // ceilDiv

        uint debtToCover = totalOwed;
        if (debtToCover > maxRepay) debtToCover = maxRepay;
        if (debtToCover > coverage) debtToCover = coverage;
        require(debtToCover > 0, "Nothing liquidatable");

        liquidationCall(collateralAsset, borrower, debtToCover, minCollateralOut);
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
     * @param perSecondFactorRAY Per-second compound factor in RAY (1e27). Must be >= RAY.
     */
    function configureAsset(
        address asset,
        uint ltv,
        uint liquidationThreshold,
        uint liquidationBonus,
        uint interestRate,
        uint reserveFactor,
        uint perSecondFactorRAY
    ) external onlyPoolConfigurator {
        require(asset != address(0) && tokenFactory.isTokenActive(asset), "Invalid or inactive asset");
        require(ltv <= liquidationThreshold, "LTV must be <= liquidation threshold");
        require(liquidationThreshold <= 9500, "Liquidation threshold too high"); // Max 95%
        require(liquidationBonus >= 10000 && liquidationBonus <= 12500, "Invalid liquidation bonus"); // 100-125%
        require(interestRate <= 10000, "Interest rate too high"); // Max 100%
        require(reserveFactor <= 5000, "Reserve factor too high"); // Max 50%
        require(perSecondFactorRAY >= RAY, "Invalid per-second factor");

        bool isBorrowAsset = (asset == borrowableAsset);
        bool canAccrue =
            isBorrowAsset &&
            assetConfigs[asset].perSecondFactorRAY > 0 &&
            borrowIndex != 0 &&
            lastAccrual != 0;

        if (canAccrue) {
            _accrue();
        }

        // If this is a new asset, add it to configuredAssets array
        if (assetConfigs[asset].ltv == 0 && assetConfigs[asset].liquidationThreshold == 0) {
            configuredAssets.push(asset);
        }

        assetConfigs[asset] = AssetConfig(
            ltv,
            liquidationThreshold,
            liquidationBonus,
            interestRate,
            reserveFactor,
            perSecondFactorRAY
        );

        emit AssetConfigured(asset, ltv, liquidationThreshold, liquidationBonus, interestRate, reserveFactor, perSecondFactorRAY);
    }


    /**
     * @notice Get asset configuration
     * @param asset The asset address
     * @return ltv, liquidationThreshold, liquidationBonus, interestRate, reserveFactor
     */
    function getAssetConfig(address asset) external view returns (uint, uint, uint, uint, uint, uint) {
        AssetConfig memory config = assetConfigs[asset];
        return (config.ltv, config.liquidationThreshold, config.liquidationBonus, config.interestRate, config.reserveFactor, config.perSecondFactorRAY);
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
        uint underlying = cash + debt + badDebt;  // ← add recognized receivable
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

        uint perSec = assetConfigs[borrowableAsset].perSecondFactorRAY;
        require(perSec > 0, "Compound factor not set");
        uint idx1 = (idx0 * rpow(perSec, dt, RAY)) / RAY;
        borrowIndex = idx1;
        lastAccrual = ts;

        uint rateBps = assetConfigs[borrowableAsset].interestRate;

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

    function setSafetyModule(address _safetyModule) external onlyPoolConfigurator {
        safetyModule = SafetyModule(_safetyModule);
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

     // Setter function for updating the share of reserves for safety module
     function setSafetyShareBps(uint bps) external onlyPoolConfigurator {
        require(bps <= 10000, "LP:bad bps");
        safetyShareBps = bps;
    }

    /// @notice Sweep protocol reserves to FeeCollector (bounded by cash & reserves)
    function sweepReserves(uint amount) external onlyPoolConfigurator {
        if (amount == 0 || reservesAccrued == 0) return;
        _accrue();

        uint cash = IERC20(borrowableAsset).balanceOf(address(_liquidityPool()));
        uint toSend = amount;
        if (toSend > reservesAccrued) toSend = reservesAccrued;
        if (toSend > cash) toSend = cash;
        if (toSend == 0) return;

        uint toSafety = (toSend * safetyShareBps) / 10000;
        uint toTreas  = toSend - toSafety;

        // Pay SM directly from LiquidityPool
        if (toSafety > 0 && address(safetyModule) != address(0)) {
            LiquidityPool(_liquidityPool()).transferReserve(toSafety, address(safetyModule));
            // Optional: if you want a log inside SM, you could later have governance call SM.notifyReward(toSafety).
            // Not required for accounting; SM.totalAssets() reads its balance directly.
        }

        // Pay treasury/feeCollector as usual
        if (toTreas > 0 && address(feeCollector) != address(0)) {
            LiquidityPool(_liquidityPool()).transferReserve(toTreas, address(feeCollector));
        }

        reservesAccrued -= toSend;

        emit ReservesSweptSafety(toSafety, address(safetyModule));
        emit ReservesSweptTreasury(toTreas, address(feeCollector));
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
    *  - Uses compound if `perSecondFactorRAY` is set
    *  - If `block.timestamp == lastAccrual`, returns the current `borrowIndex` unchanged.
    *  - Units: RAY (1e27).
    * @return projectedIndex The projected borrow index in RAY units.
    */
    function previewBorrowIndex() public view returns (uint projectedIndex) {
        if (block.timestamp == lastAccrual) return borrowIndex;
        uint dt = uint(block.timestamp - lastAccrual);
        uint perSec = assetConfigs[borrowableAsset].perSecondFactorRAY;
        require(perSec > 0, "Compound factor not set");
        uint mul = rpow(perSec, dt, RAY);
        return (borrowIndex * mul) / RAY;
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

    // ═══════════════════════════════════════════════════════════════════════════════
    // BAD DEBT  FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
    * @notice Recognize a borrower's remaining loan as bad debt and sweep any residual collateral.
    * @dev Minimal side effects:
    *      - Accrues interest, converts scaled → base, removes loan from accrual, bumps `badDebt`.
    *      - Iterates configured assets and seizes any leftover collateral balances (>0) to `feeCollector`.
    *      - No-op if borrower still has liquidation-weighted value or has no scaled debt.
    */
    function recognizeBadDebt(address borrower) external onlyPoolConfigurator {
        _accrue();
        if (_getTotalCollateralValueForHealth(borrower) > 0) return;

        LoanInfo storage ln = userLoan[borrower];
        uint scaled = ln.scaledDebt;
        if (scaled == 0) return;

        uint baseBad = (scaled * borrowIndex) / RAY;

        // stop interest accrual on this borrower
        totalScaledDebt -= scaled;
        ln.scaledDebt = 0;
        delete userLoan[borrower];

        // track non-accruing receivable
        badDebt += baseBad;

        // Sweep any residual collateral (even if liquidation-weighted value was 0)
        CollateralVault vault = _collateralVault();
        require (address(feeCollector) != address(0), "LP: Fee collector not set");
        uint n = configuredAssets.length;
        for (uint i = 0; i < n; i++) {
            address collateral = configuredAssets[i];
            uint amt = vault.userCollaterals(borrower, collateral);
            if (amt != 0) {
                vault.seizeCollateral(borrower, address(feeCollector), collateral, amt); // vault emits CollateralRemoved
            }
        }

        emit BadDebtRecognized(baseBad);
        emit ExchangeRateUpdated(borrowableAsset, getExchangeRate());
    }

    function coverShortfall(uint amount) external {
        require(msg.sender == address(safetyModule), "LP:not SM");
        require(amount > 0, "LP:zero");

        // Cash already moved to LiquidityPool by SM in the same tx.
        uint cover = amount <= badDebt ? amount : badDebt;
        if (cover > 0) {
            badDebt -= cover;
            emit BadDebtCovered(cover, badDebt);
        }

        // Any excess cash simply improves liquidity until swept to reserves
        emit ExchangeRateUpdated(borrowableAsset, getExchangeRate());
    }

    function writeOffBadDebtFromReserves(uint amount) external onlyPoolConfigurator {
        if (amount == 0) return;
        _accrue();

        // capacity = min(reservesAccrued, badDebt)
        uint cap = reservesAccrued < badDebt ? reservesAccrued : badDebt;
        if (cap == 0) return;

        // use at most the amount sent, further capped by capacity
        uint writeOff = amount <= cap ? amount : cap;

        reservesAccrued -= writeOff;
        badDebt        -= writeOff;

        emit BadDebtWrittenOffFromReserves(writeOff, badDebt, reservesAccrued);
        emit ExchangeRateUpdated(borrowableAsset, getExchangeRate());
    }

    /// @notice LAST-RESORT: write off bad debt without funding (haircut depositors).
    /// @dev Reduces `badDebt` directly, which lowers getExchangeRate() once, pro-rata for all mToken holders.
    ///      Use only after attempting SM coverage and reserves write-off.
    function writeOffBadDebtWithHaircut(uint amount, string calldata reason) external onlyPoolConfigurator
    {
        require(amount > 0, "LP:zero");
        _accrue();

        uint writeOff = amount <= badDebt ? amount : badDebt;
        if (writeOff == 0) return;

        badDebt -= writeOff;

        emit DepositorHaircutApplied(writeOff, badDebt, reason);
        emit ExchangeRateUpdated(borrowableAsset, getExchangeRate());
    }
}
