// CDPEngine
// - Core CDP logic for multi-collateral USDST mint/burn
// - Accrues stability fee via rateAccumulator (RAY); all debt reads use scaledDebt * rate / RAY
// - Liquidation with direct seize (no auctions)
// - Fees: split between FeeCollector and CDPReserve (feeToReserveBps)
// - Pro-rata juniors: splits USDST from reserve across all active notes proportionally to their remaining caps
// - UPDATED: Per-asset minCR (minCR). User actions (borrow/withdraw) must keep CR ≥ minCR.
//            minCR is stored per asset in CollateralConfig and must be ≥ liquidationRatio.

import "./CDPVault.sol";
import "../Tokens/Token.sol";
import "../Tokens/TokenFactory.sol";
import "../Lending/PriceOracle.sol";
import "./CDPRegistry.sol";
import "../Admin/FeeCollector.sol";
import "./CDPReserve.sol";

import "../../abstract/ERC20/access/Ownable.sol";

contract record CDPEngine is Ownable {
    // Registry and shared components resolved from the registry
    CDPRegistry public registry;
    // Resolve Token, TokenFactory, and FeeCollector via registry at call time

    // Per‑asset configuration (see setCollateralAssetParams)
    struct CollateralConfig {
        uint liquidationRatio;          // WAD (e.g. 1.50e18)
        uint minCR;                     // WAD (e.g. 1.60e18) — action gate CR (must be ≥ liquidationRatio)
        uint liquidationPenaltyBps;     // 10000 = 100%
        uint closeFactorBps;            // 10000 = 100%
        uint stabilityFeeRate;          // per‑second factor (RAY)
        uint debtFloor;                 // minimum debt per vault (USD 1e18)
        uint debtCeiling;               // asset debt ceiling (USD 1e18)
        uint unitScale;                 // token units to 1e18 scale factor
        bool isPaused;                  // asset pause switch (all ops)
    }

    // Per‑asset global state
    struct CollateralGlobalState {
        uint rateAccumulator;   // RAY (>= RAY)
        uint lastAccrual;       // timestamp
        uint totalScaledDebt;   // sum of normalized principal (scaledDebt) across vaults
    }

    // Per‑vault state keyed by (user, asset)
    struct Vault {
        uint collateral;  // raw token units
        uint scaledDebt;  // index‑denominated debt
    }

    mapping(address => CollateralConfig) public record collateralConfigs;
    mapping(address => CollateralGlobalState) public record collateralGlobalStates;
    mapping(address => mapping(address => Vault)) public record vaults; // user => asset => vault

    bool public globalPaused;
    uint public RAY = 1e27;
    uint public WAD = 1e18;
    mapping(address => bool) public record isSupportedAsset;

    uint256 public feeToReserveBps; // portion of feeUSD sent to CDPReserve (0..10000)
    uint public priceMaxAge = 1200;

    event FeeToReserveBpsSet(uint256 oldBps, uint256 newBps);
    event FeesRouted(address indexed asset, uint256 toReserve, uint256 toCollector);
    event PriceMaxAgeSet(uint oldMaxAge, uint newMaxAge);

    // ─────────────── Events ───────────────
    event CollateralConfigured(
        address indexed asset,
        uint liquidationRatio,
        uint minCR,
        uint liquidationPenaltyBps,
        uint closeFactorBps,
        uint stabilityFeeRate,
        uint debtFloor,
        uint debtCeiling,
        uint unitScale,
        bool pause
    );

    event Accrued(
        address indexed asset,
        uint oldRate,
        uint newRate,
        uint deltaTime,
        uint totalScaledDebt
    );

    event Deposited(address indexed owner, address indexed asset, uint amount);
    event Withdrawn(address indexed owner, address indexed asset, uint amount);

    event USDSTMinted(
        address indexed owner,
        address indexed asset,
        uint amountUSD,
        uint totalScaledDebt,
        uint rateAccumulator
    );

    event USDSTBurned(
        address indexed owner,
        address indexed asset,
        uint amountUSD,
        uint totalScaledDebt,
        uint rateAccumulator
    );

    event LiquidationExecuted(
        address indexed borrower,
        address indexed asset,
        uint debtBurnedUSD,
        uint penaltyUSD,
        uint collateralOut,
        address indexed liquidator,
        uint remainingDebtUSD,
        uint rateAccumulator
    );
    event Paused(address indexed asset, bool isPaused);
    event PausedGlobal(bool isPaused);
    event JuniorParamsSet(uint premiumBps, uint sliceBps);
    
    event VaultUpdated(
        address indexed user,
        address indexed asset,
        uint collateral,
        uint scaledDebt
    );

    event RegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    
    // ───────────────────────── Registry Access Helpers ──────────────────────
    function _cdpVault() internal view returns (CDPVault) { return registry.cdpVault(); }
    function _cdpPriceOracle() internal view returns (PriceOracle) { return registry.priceOracle(); }
    function _usdst() internal view returns (Token) { return Token(address(registry.usdst())); }
    function _tokenFactory() internal view returns (TokenFactory) { return TokenFactory(address(registry.tokenFactory())); }
    function _feeCollector() internal view returns (FeeCollector) { return FeeCollector(address(registry.feeCollector())); }
    function _cdpReserve() internal view returns (CDPReserve) { return registry.cdpReserve(); }

    // ─────────────────────────── Access Modifiers ───────────────────────────
    modifier whenNotPaused(address asset) {
        require(!globalPaused, "CDPEngine: global pause");
        require(!collateralConfigs[asset].isPaused, "CDPEngine: asset paused");
        _;
    }

    modifier onlyKnownAsset(address asset) { 
        require(isSupportedAsset[asset], "unsupported"); _; 
    }

    modifier onlyActiveAsset(address asset) {
        require(isSupportedAsset[asset], "unsupported");
        require(_tokenFactory().isTokenActive(asset), "inactive");
        _;
    }
    
    // ─────────────────────────────── Constructor ─────────────────────────────
    constructor(address initialOwner) Ownable(initialOwner) { }

    function initialize(address _registry) external onlyOwner {
        // @dev important: must be set here for proxied instances; ensure consistency with desired initial values
        RAY = 1e27;
        WAD = 1e18;
        priceMaxAge = 1200;

        require(_registry != address(0), "CDPEngine: invalid registry");
        registry = CDPRegistry(_registry);
    }

    /**
     * @notice Update registry reference and resync dependent addresses
     * @dev Must be called after wiring the registry to ensure cached references are set
     */
    function setRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "CDPEngine: invalid registry");
        address old = address(registry);
        registry = CDPRegistry(_registry);
        emit RegistryUpdated(old, _registry);
    }

    function setFeeToReserveBps(uint256 newBps) external onlyOwner {
        require(newBps <= 10000, "fee bps > 10000");
        uint256 old = feeToReserveBps;
        feeToReserveBps = newBps;
        emit FeeToReserveBpsSet(old, newBps);
    }

    function setPriceMaxAge(uint newMaxAge) external onlyOwner {
        uint old = priceMaxAge;
        priceMaxAge = newMaxAge;
        emit PriceMaxAgeSet(old, newMaxAge);
    }

    /**
     * @notice Internal helper to route fees between Reserve and FeeCollector
     * @dev Mints USDST fees and splits according to feeToReserveBps
     * @param asset The collateral asset (for event logging)
     * @param feeUSD The total fee amount to route
     */
    function _routeFees(address asset, uint256 feeUSD) internal {
        if (feeUSD > 0) {
            // Simple two-way split: Reserve vs FeeCollector
            uint256 toReserve   = (feeUSD * feeToReserveBps) / 10000;
            uint256 toCollector = feeUSD - toReserve;

            if (toReserve > 0) Token(_usdst()).mint(address(_cdpReserve()), toReserve);
            if (toCollector > 0) Token(_usdst()).mint(address(_feeCollector()), toCollector);

            emit FeesRouted(asset, toReserve, toCollector);
        }
    }

    // ───────────────────────────── User Actions ──────────────────────────────
    /**
     * @notice Deposit collateral from msg.sender into their vault
     * @dev Pulls tokens via transferFrom into CDPVault custody; emits Deposited and VaultUpdated
     */
    function deposit(address asset, uint amount) external whenNotPaused(asset) onlyActiveAsset(asset) {
        require(amount > 0, "CDPEngine: Invalid amount");
        // Move collateral into vault custody and update in-memory vault balance
        _cdpVault().deposit(msg.sender, asset, amount);
        vaults[msg.sender][asset].collateral += amount;
        emit Deposited(msg.sender, asset, amount);
        emit VaultUpdated(msg.sender, asset, vaults[msg.sender][asset].collateral, vaults[msg.sender][asset].scaledDebt);
    }

    /**
     * @notice Withdraw explicit amount of collateral; requires CR ≥ minCR when debt > 0
     * @dev Accrues first; reverts if resulting CR would fall below threshold
     */
    function withdraw(address asset, uint amount) external onlyKnownAsset(asset) {
        require(amount > 0, "CDPEngine: Invalid amount");
        Vault storage vault = vaults[msg.sender][asset];
        require(vault.collateral >= amount, "CDPEngine: Insufficient collateral");
        // Always accrue before reading debt/CR sensitive values
        _accrue(asset);
        // Optimistically reduce collateral, then validate CR if debt remains
        vault.collateral -= amount;
        if (vault.scaledDebt > 0) {
            uint crAfter = collateralizationRatio(msg.sender, asset);
            require(crAfter >= collateralConfigs[asset].minCR, "CDPEngine: below min CR");
        }
        // Perform custody move after checks
        _cdpVault().withdraw(msg.sender, asset, amount);
        emit Withdrawn(msg.sender, asset, amount);
        emit VaultUpdated(msg.sender, asset, vault.collateral, vault.scaledDebt);
    }

    /**
     * @notice Withdraw maximum safe collateral while preserving CR ≥ minCR
     * @dev Applies a +1 wei buffer when there is outstanding debt to avoid edge rounding
     * @return maxAmount The amount withdrawn
     */
    function withdrawMax(address asset) external onlyKnownAsset(asset) returns (uint maxAmount) {
        // Accrue to get an up-to-date rateAccumulator before computing debt
        _accrue(asset);
        Vault storage vault = vaults[msg.sender][asset];
        uint debt = (vault.scaledDebt * collateralGlobalStates[asset].rateAccumulator) / RAY;
        if (debt == 0) {
            // No debt: user can withdraw all collateral
            maxAmount = vault.collateral;
        } else {
            // Compute collateral required to keep CR >= minCR
            (uint price, uint timestamp) = _cdpPriceOracle().getAssetPriceWithTimestamp(asset);
            require(price > 0, "invalid price");
            require(block.timestamp - timestamp <= priceMaxAge, "CDPEngine: stale price");
            CollateralConfig memory config = collateralConfigs[asset];
            uint requiredCollateralValue = (debt * config.minCR) / WAD;
            uint requiredCollateral = (requiredCollateralValue * config.unitScale) / price;
            // Enforce a 1 wei buffer when debt exists to protect against rounding
            if (vault.collateral <= requiredCollateral + 1) {
                maxAmount = 0; // exactly at buffer or below => nothing withdrawable
            } else {
                maxAmount = vault.collateral - requiredCollateral - 1;
            }
        }
        if (maxAmount > 0) {
            // Update vault balance then move funds from custody
            vault.collateral -= maxAmount;
            _cdpVault().withdraw(msg.sender, asset, maxAmount);
            emit Withdrawn(msg.sender, asset, maxAmount);
            emit VaultUpdated(msg.sender, asset, vault.collateral, vault.scaledDebt);
        }
    }

    /**
     * @notice Mint a specific amount of USDST against collateral
     * @dev Checks debtCeiling and debtFloor, accrues first, and updates scaled debt and books
     *      Enforces CR ≥ minCR after mint
     */
    function mint(address asset, uint amountUSD) external whenNotPaused(asset) onlyActiveAsset(asset) {
        // Accrue fees so debt math uses the latest rateAccumulator
        _accrue(asset);
        require(amountUSD > 0, "CDPEngine: zero amount");
        // Load config/state and caller's vault
        CollateralConfig memory assetConfig = collateralConfigs[asset];
        CollateralGlobalState storage assetState = collateralGlobalStates[asset];
        Vault storage userVault = vaults[msg.sender][asset];
        // Compute current debt in USD using scaledDebt and rateAccumulator
        uint currentDebt = (userVault.scaledDebt * assetState.rateAccumulator) / RAY;
        // Value collateral in USD and compute borrow headroom from minCR
        (uint price, uint timestamp) = _cdpPriceOracle().getAssetPriceWithTimestamp(asset);
        require(price > 0, "invalid price");
        require(block.timestamp - timestamp <= priceMaxAge, "CDPEngine: stale price");
        uint collateralValueUSD_calc = (userVault.collateral * price) / assetConfig.unitScale;
        uint maxBorrowableUSD = (collateralValueUSD_calc * WAD) / assetConfig.minCR;
        require(currentDebt + amountUSD < maxBorrowableUSD, "CDPEngine: insufficient collateral");
        // Enforce per-asset debt ceiling vs current outstanding debt (Maker-style)
        if (assetConfig.debtCeiling > 0) {
            uint assetDebtUSD = (assetState.totalScaledDebt * assetState.rateAccumulator) / RAY;
            require(assetDebtUSD + amountUSD <= assetConfig.debtCeiling, "CDPEngine: debt ceiling exceeded");
        }       
        // Increase scaled debt (principal) using current index
        uint scaledAdd = (amountUSD * RAY + assetState.rateAccumulator - 1) / assetState.rateAccumulator;
        userVault.scaledDebt += scaledAdd;
        assetState.totalScaledDebt += scaledAdd;
        // Enforce per-vault debt floor post-mint
        uint totalDebtAfter = (userVault.scaledDebt * assetState.rateAccumulator) / RAY;
        if (assetConfig.debtFloor > 0) {
            require(totalDebtAfter >= assetConfig.debtFloor, "CDPEngine: below debt floor");
        }
        // Mint USDST to the user; fees will be realized on repay
        Token(_usdst()).mint(msg.sender, amountUSD);
        emit USDSTMinted(msg.sender, asset, amountUSD, assetState.totalScaledDebt, assetState.rateAccumulator);
        emit VaultUpdated(msg.sender, asset, userVault.collateral, userVault.scaledDebt);
    }

    /**
     * @notice Mint the maximum safe USDST amount (applies 1-wei buffer)
     * @dev Computes headroom from CR and minCR, enforces ceiling/floor, and mints to user
     */
    function mintMax(address asset) external whenNotPaused(asset) onlyActiveAsset(asset) returns (uint amountMinted) {
        // Accrue to make the index current
        _accrue(asset);
        CollateralConfig memory config = collateralConfigs[asset];
        CollateralGlobalState storage assetState = collateralGlobalStates[asset];
        Vault storage userVault = vaults[msg.sender][asset];
        // Current owed in USD
        uint currentDebt = (userVault.scaledDebt * assetState.rateAccumulator) / RAY;
        // Compute borrow headroom from collateral value and minCR
        (uint price, uint timestamp) = _cdpPriceOracle().getAssetPriceWithTimestamp(asset);
        require(price > 0, "invalid price");
        require(block.timestamp - timestamp <= priceMaxAge, "CDPEngine: stale price");
        uint collateralValueUSD_calc = (userVault.collateral * price) / config.unitScale;
        uint maxBorrowableUSD = (collateralValueUSD_calc * WAD) / config.minCR;
        require(maxBorrowableUSD > currentDebt, "No borrowing power");
        uint available = maxBorrowableUSD - currentDebt;
        // Apply 1 wei buffer to avoid rounding into liquidation edge
        amountMinted = available > 1 ? (available - 1) : 0; // 1-wei safety buffer
        require(amountMinted > 0, "No borrowing power");
        // Enforce per-asset ceiling vs current outstanding debt
        if (config.debtCeiling > 0) {
            uint assetDebtUSD = (assetState.totalScaledDebt * assetState.rateAccumulator) / RAY;
            require(assetDebtUSD + amountMinted <= config.debtCeiling, "CDPEngine: debt ceiling exceeded");
        }
        // Increase scaled principal at current index
        uint scaledAdd = (amountMinted * RAY + assetState.rateAccumulator - 1) / assetState.rateAccumulator;
        userVault.scaledDebt += scaledAdd;
        assetState.totalScaledDebt += scaledAdd;
        // Enforce per-vault floor after mint
        uint totalDebtAfter = (userVault.scaledDebt * assetState.rateAccumulator) / RAY;
        if (config.debtFloor > 0) {
            require(totalDebtAfter >= config.debtFloor, "CDPEngine: below debt floor");
        }
        // Mint funds to the user
        Token(_usdst()).mint(msg.sender, amountMinted);
        emit USDSTMinted(msg.sender, asset, amountMinted, assetState.totalScaledDebt, assetState.rateAccumulator);
        emit VaultUpdated(msg.sender, asset, userVault.collateral, userVault.scaledDebt);
    }

    function repay(address asset, uint amountUSD) external onlyKnownAsset(asset) {
        _accrue(asset);
        require(amountUSD > 0, "CDPEngine: zero amount");

        CollateralConfig memory config = collateralConfigs[asset];
        CollateralGlobalState storage assetState = collateralGlobalStates[asset];
        Vault storage userVault = vaults[msg.sender][asset];

        uint owed = (userVault.scaledDebt * assetState.rateAccumulator) / RAY;
        require(owed > 0, "CDPEngine: no debt");

        // Convert request to normalized delta
        uint repayAmount = amountUSD > owed ? owed : amountUSD;
        uint scaledDelta = (repayAmount * RAY) / assetState.rateAccumulator;
        if (scaledDelta > userVault.scaledDebt) scaledDelta = userVault.scaledDebt;

        // Preview post-repay debt for floor check
        uint newScaledDebt = userVault.scaledDebt - scaledDelta;
        uint owedAfterPreview = (newScaledDebt * assetState.rateAccumulator) / RAY;
        if (owedAfterPreview > 1 && config.debtFloor > 0 && owedAfterPreview < config.debtFloor) {
            revert("CDPEngine: repay leaves debt below floor; use repayAll");
        }

        // Exact extinguished USD at current index
        uint owedForDelta = (scaledDelta * assetState.rateAccumulator) / RAY;
        uint baseUSD = scaledDelta;
        uint feeUSD  = owedForDelta > baseUSD ? (owedForDelta - baseUSD) : 0;

        Token(_usdst()).burn(msg.sender, owedForDelta);

        // Route fees between Reserve and FeeCollector
        _routeFees(asset, feeUSD);

        userVault.scaledDebt = newScaledDebt;
        assetState.totalScaledDebt -= scaledDelta;

        // Dust cleanup (≤ 1 wei of USD debt)
        if (owedAfterPreview <= 1) {
            if (userVault.scaledDebt > 0) {
                assetState.totalScaledDebt -= userVault.scaledDebt;
                userVault.scaledDebt = 0;
            }
        }

        emit USDSTBurned(msg.sender, asset, owedForDelta, assetState.totalScaledDebt, assetState.rateAccumulator);
        emit VaultUpdated(msg.sender, asset, userVault.collateral, userVault.scaledDebt);
    }

    /**
     * @notice Repay all USDST debt and clear rounding by setting scaledDebt to zero
     * @dev Burns full owed (principal + fee), mints fee to collector, and zeroes principal book
     */
    function repayAll(address asset) external onlyKnownAsset(asset) {
        // Accrue to settle fees and compute exact owed at current index
        _accrue(asset);
        CollateralGlobalState storage assetState = collateralGlobalStates[asset];
        Vault storage userVault = vaults[msg.sender][asset];
        require(userVault.scaledDebt > 0, "CDPEngine: no debt");
        // Total owed in USD includes both principal and stability fee
        uint owed = (userVault.scaledDebt * assetState.rateAccumulator) / RAY;
        uint scaledDebtToRemove = userVault.scaledDebt;
        // Burn user's USDST equal to owed
        Token(_usdst()).burn(msg.sender, owed);
        // Split owed into base principal and fee components
        uint baseUSD = scaledDebtToRemove; // normalized principal (scaled units)
        uint feeUSD = owed > baseUSD ? (owed - baseUSD) : 0;

        // Route fees between Reserve and FeeCollector
        _routeFees(asset, feeUSD);

        userVault.scaledDebt = 0;
        assetState.totalScaledDebt -= scaledDebtToRemove;

        emit USDSTBurned(msg.sender, asset, owed, assetState.totalScaledDebt, assetState.rateAccumulator);
        emit VaultUpdated(msg.sender, asset, userVault.collateral, userVault.scaledDebt);
    }

    /**
    * @notice Liquidate an undercollateralized vault for a given collateral asset
    * @dev Steps:
    *      - Accrue, assert unhealthy (CR < LR)
    *      - Cap repay by totalDebt, closeFactor, and coverage INCLUDING penalty
    *      - Burn EXACT debt extinguished (handles rounding)
    *      - Mint fee to FeeCollector; reduce scaled principal/books
    *      - Seize collateral equal to (repay + penalty) at oracle price
    *      - Emit events and dust-clean if remainder <= 1 wei
    * @param collateralAsset Address of the collateral token
    * @param borrower Address of the vault owner being liquidated
    * @param debtToCover Desired repay amount in wei (18 decimals)
    */
    function liquidate(
        address collateralAsset,
        address borrower,
        uint debtToCover
    ) external onlyKnownAsset(collateralAsset) {
        require(borrower != address(0) && borrower != msg.sender, "CDPEngine: invalid borrower");
        require(debtToCover > 0, "CDPEngine: zero debt amount");

        _accrue(collateralAsset);

        CollateralConfig memory config = collateralConfigs[collateralAsset];
        CollateralGlobalState storage assetState = collateralGlobalStates[collateralAsset];
        Vault storage borrowerVault = vaults[borrower][collateralAsset];
        require(borrowerVault.scaledDebt > 0, "CDPEngine: no debt to liquidate");

        uint borrowerCR = collateralizationRatio(borrower, collateralAsset);
        require(borrowerCR < config.liquidationRatio, "CDPEngine: position healthy");

        // Prices & caps
        (uint priceCollWei, uint timestamp) = _cdpPriceOracle().getAssetPriceWithTimestamp(collateralAsset);
        require(priceCollWei > 0, "CDPEngine: invalid collateral price");
        require(block.timestamp - timestamp <= priceMaxAge, "CDPEngine: stale price");

        uint totalDebtWei   = (borrowerVault.scaledDebt * assetState.rateAccumulator) / RAY;
        uint closeFactorCap = (totalDebtWei * config.closeFactorBps) / 10000;

        uint collateralWei = (borrowerVault.collateral * priceCollWei) / config.unitScale;
        // Ensure repay + penalty can be paid fully in collateral:
        // repay <= collateralWei * 10000 / (10000 + penaltyBps)
        uint coverageCap = (collateralWei * 10000) / (10000 + config.liquidationPenaltyBps);
        
        // Repay amount capped by all constraints
        bool capBinds = false;
        uint repay = debtToCover;
        if (repay > totalDebtWei)   repay = totalDebtWei;
        if (repay > closeFactorCap) repay = closeFactorCap;
        if (repay >= coverageCap) { repay = coverageCap; capBinds = true; }
        require(repay > 0, "CDPEngine: nothing to liquidate");

        uint collateralToSeize = 0;
        uint penaltyWei = 0;

        // Convert to scaled and clamp to vault's scaledDebt
        uint scaledDebtToLiquidate = (repay * RAY) / assetState.rateAccumulator;
        if (scaledDebtToLiquidate > borrowerVault.scaledDebt) {
            scaledDebtToLiquidate = borrowerVault.scaledDebt;
        }
        uint owedForDelta = (scaledDebtToLiquidate * assetState.rateAccumulator) / RAY;

        // burn exact, route only interest
        Token(_usdst()).burn(msg.sender, owedForDelta);

        uint feeWei = owedForDelta > scaledDebtToLiquidate ? (owedForDelta - scaledDebtToLiquidate) : 0;
        if (feeWei > 0) _routeFees(collateralAsset, feeWei);

        borrowerVault.scaledDebt   -= scaledDebtToLiquidate;
        assetState.totalScaledDebt -= scaledDebtToLiquidate;

        if (capBinds) {
            collateralToSeize = borrowerVault.collateral;
            uint collateralUSD = (collateralToSeize * priceCollWei) / config.unitScale;
            penaltyWei = collateralUSD > owedForDelta ? (collateralUSD - owedForDelta) : 0;
        } else {
            penaltyWei = (owedForDelta * config.liquidationPenaltyBps) / 10000;
            uint debtWithPenaltyWei = owedForDelta + penaltyWei;
            collateralToSeize = (debtWithPenaltyWei * config.unitScale) / priceCollWei;
            if (collateralToSeize > borrowerVault.collateral) {
                collateralToSeize = borrowerVault.collateral;
            }
        }

        borrowerVault.collateral -= collateralToSeize;
        _cdpVault().seize(borrower, collateralAsset, msg.sender, collateralToSeize);

        uint finalDebtWei = (borrowerVault.scaledDebt * assetState.rateAccumulator) / RAY;

        if (borrowerVault.collateral == 0) {
            uint rem = (borrowerVault.scaledDebt * assetState.rateAccumulator) / RAY;
            if (rem > 1) {
                assetState.totalScaledDebt -= borrowerVault.scaledDebt;
                borrowerVault.scaledDebt = 0;
                badDebtUSDST[collateralAsset] += rem;
                emit BadDebtRealized(collateralAsset, borrower, rem);
            }
        }

        emit LiquidationExecuted(
            borrower,
            collateralAsset,
            owedForDelta,          
            penaltyWei,
            collateralToSeize,
            msg.sender,
            finalDebtWei,
            assetState.rateAccumulator
        );

        emit VaultUpdated(borrower, collateralAsset, borrowerVault.collateral, borrowerVault.scaledDebt);
    }

    // ───────────────────────── Accrual & Views ──────────────────────────────
    /**
     * @notice Accrue stability fees for an asset by advancing the rateAccumulator
     * @dev Uses discrete compounding: newRate = oldRate * rpow(stabilityFeeRate, dt, RAY) / RAY
     */
    function _accrue(address asset) internal {
        // Load config/state for the collateral asset
        CollateralConfig memory assetConfig = collateralConfigs[asset];
        CollateralGlobalState storage assetState = collateralGlobalStates[asset];
        if (assetState.lastAccrual == 0) {
            assetState.lastAccrual = block.timestamp;
            assetState.rateAccumulator = RAY;
            return;
        }
        uint dt = block.timestamp - assetState.lastAccrual; if (dt == 0) return;
        uint oldRate = assetState.rateAccumulator;
        // Compute per-period factor via fixed-point exponentiation (RAY scale)
        uint factor = _rpow(assetConfig.stabilityFeeRate, dt, RAY);
        // Advance accumulator, ensuring monotonicity (never below RAY)
        uint newRate = (oldRate * factor) / RAY; if (newRate < RAY) { newRate = RAY; }
        // Persist state and emit observability event
        assetState.rateAccumulator = newRate; assetState.lastAccrual = block.timestamp;
        emit Accrued(asset, oldRate, assetState.rateAccumulator, dt, assetState.totalScaledDebt);
    }

    /**
     * @notice Configure per-asset risk parameters
     * @dev Validates bounds for LR, minCR, penalty, close-factor, rate, floor/ceiling, and unitScale
     */
    function setCollateralAssetParams(
        address asset,
        uint liquidationRatio,
        uint minCR,
        uint liquidationPenaltyBps,
        uint closeFactorBps,
        uint stabilityFeeRate,
        uint debtFloor,
        uint debtCeiling,
        uint unitScale,
        bool pause
    ) public onlyOwner {
        require(asset != address(0), "CDPEngine: invalid asset");
        require(liquidationRatio >= WAD, "CDPEngine: LR too low");
        require(minCR >= liquidationRatio, "CDPEngine: minCR < LR");
        require(liquidationPenaltyBps >= 500 && liquidationPenaltyBps <= 3000, "penalty out of range");
        require(closeFactorBps >= 5000 && closeFactorBps <= 10000, "CDPEngine: close factor out of range");
        require(stabilityFeeRate >= RAY, "CDPEngine: stability fee too low");
        require(unitScale > 0, "CDPEngine: invalid unit scale");
        if (debtCeiling > 0) { require(debtFloor <= debtCeiling, "CDPEngine: debt floor above ceiling"); }

        CollateralConfig storage config = collateralConfigs[asset];
        config.liquidationRatio = liquidationRatio;
        config.minCR = minCR; // 0 means "use LR"
        config.liquidationPenaltyBps = liquidationPenaltyBps; 
        config.closeFactorBps = closeFactorBps; 
        config.stabilityFeeRate = stabilityFeeRate; 
        config.debtFloor = debtFloor; 
        config.debtCeiling = debtCeiling; 
        config.unitScale = unitScale;
        config.isPaused = pause;

        if (!isSupportedAsset[asset]) { isSupportedAsset[asset] = true; }

        emit CollateralConfigured(
            asset,
            liquidationRatio,
            minCR,
            liquidationPenaltyBps,
            closeFactorBps,
            stabilityFeeRate,
            debtFloor,
            debtCeiling,
            unitScale,
            pause
        );
    }

    /**
     * @notice Batch configure multiple collateral assets in one transaction
     * @dev All arrays must have equal non-zero length N; i-th entries map to the same asset
     */
    function setCollateralAssetParamsBatch(
        address[] calldata assets,
        uint[] calldata liquidationRatios,
        uint[] calldata minCRs,
        uint[] calldata liquidationPenaltyBpsArr,
        uint[] calldata closeFactorBpsArr,
        uint[] calldata stabilityFeeRates,
        uint[] calldata debtFloors,
        uint[] calldata debtCeilings,
        uint[] calldata unitScales,
        bool[] calldata pauses
    ) external onlyOwner {
        uint len = assets.length;
        require(len > 0, "CDPEngine: empty batch");
        require(
            liquidationRatios.length == len &&
            minCRs.length == len &&
            liquidationPenaltyBpsArr.length == len &&
            closeFactorBpsArr.length == len &&
            stabilityFeeRates.length == len &&
            debtFloors.length == len &&
            debtCeilings.length == len &&
            unitScales.length == len &&
            pauses.length == len,
            "CDPEngine: array length mismatch"
        );
        for (uint i = 0; i < len; i++) {
            setCollateralAssetParams(
                assets[i],
                liquidationRatios[i],
                minCRs[i],
                liquidationPenaltyBpsArr[i],
                closeFactorBpsArr[i],
                stabilityFeeRates[i],
                debtFloors[i],
                debtCeilings[i],
                unitScales[i],
                pauses[i]
            );
        }
    }

    /** Owner-only: pause/unpause a specific asset */
    function setPaused(address asset, bool isPaused) external onlyOwner {
        require(isSupportedAsset[asset], "CDPEngine: unsupported asset");
        collateralConfigs[asset].isPaused = isPaused;
        emit Paused(asset, isPaused);
    }

    /** Owner-only: pause/unpause the entire CDP engine */
    function setPausedGlobal(bool isPaused) external onlyOwner {
        globalPaused = isPaused;
        emit PausedGlobal(isPaused);
    }

    /**
     * @dev Fixed-point exponentiation (Maker-style), rounding half up.
     * @param x Base in RAY
     * @param n Exponent (uint)
     * @param base Radix (RAY = 1e27)
     * @return z Result in RAY
     */
    function _rpow(uint x, uint n, uint base) internal pure returns (uint z) {
        if (x == 0) return n == 0 ? base : 0;
        z = (n % 2 == 0) ? base : x;
        uint half = base / 2;
        for (n /= 2; n > 0; n /= 2) {
            uint xx = x * x;
            x = (xx + half) / base; // round
            if (n % 2 == 1) {
                uint zx = z * x;
                z = (zx + half) / base; // round
            }
        }
        return z;
    }

    /**
    * @notice Compute the user's collateralization ratio for a given asset (WAD scale; 1e18 = 1.0).
    * @dev CR = collateralUSD / debtUSD
    *      collateralUSD = (vault.collateral * price) / unitScale
    *      debtUSD      = (vault.scaledDebt * rateAccumulator) / RAY
    *      Returns type(uint).max when debt is zero (interpreted as infinite CR).
    * @param user  Vault owner address.
    * @param asset Collateral asset address.
    * @return crWad Collateralization ratio in WAD units.
    */



    function collateralizationRatio(address user, address asset) public view returns (uint crWad) {
        CollateralGlobalState storage s = collateralGlobalStates[asset];
        Vault storage v = vaults[user][asset];
        uint debtUSD = (v.scaledDebt * s.rateAccumulator) / RAY;
        if (debtUSD == 0) return (2**256 - 1); 
        (uint price, uint timestamp) = _cdpPriceOracle().getAssetPriceWithTimestamp(asset);
        require(price > 0, "invalid price");
        require(block.timestamp - timestamp <= priceMaxAge, "CDPEngine: stale price");
        uint unitScale = collateralConfigs[asset].unitScale;
        uint collateralUSD = unitScale == 0 ? 0 : (v.collateral * price) / unitScale;
        return (collateralUSD * WAD) / debtUSD;
    }





    // ═══════════════════════════════════════════════════════════════════════════════════════════════════
    // ═══════════════════════════════════ BAD DEBT & JUNIOR SYSTEM ═══════════════════════════════════════
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════





    // ─────────────── Bad Debt State ───────────────

    mapping(address => uint) public record badDebtUSDST; // 1e18, bad debt (per-asset), non-accruing
    uint256 public juniorPremiumBps;   // e.g., 1000 = +10% payout premium over principal burned

    // ─── Pro-rata juniors via global index fed by Reserve inflows ───
    // juniorIndex is RAY (1e27) and means: cumulative USD distributed per 1 USD of outstanding cap.
    uint256 public juniorIndex;                   // init lazily to 1e27
    uint256 public totalJuniorOutstandingUSDST;   // sum of all capUSDST
    uint256 private prevReserveBalance;          // last Reserve balance accounted into index

    struct JuniorNote {
        address owner;
        uint256 capUSDST;     // remaining cap in wei (decreases on claims)
        uint256 entryIndex;   // earning baseline (resets on claims)
    }

    mapping(address => JuniorNote) public record juniorNotes;


    // ─────────────── Bad Debt Events ───────────────

    event BadDebtRealized(address indexed asset, address indexed borrower, uint amountUSDST);
    event BadDebtRepaid(address indexed asset, uint amountUSDST, uint badDebtRemaining);
    event JuniorNoteCreated(address indexed owner, uint256 capUSDST);
    event JuniorNoteClosed(address indexed owner);
    event JuniorNoteClaimed(address indexed owner, uint256 paidUSDST, uint256 remainingUSDST);
    /// @notice Emitted whenever new Reserve inflows are indexed into juniorIndex.
    /// @dev progressWad is the per-sync fraction toward cap (x) in 1e18 (WAD) units.
    ///      Sum progressWad across a time window (and divide by 1e18) to get S for that window.
    event JuniorIndexSynced(
        uint256 deltaUSDST,         // USDST newly observed in Reserve for this sync
        uint256 outstandingUSDST,   // totalJuniorOutstandingUSDST used for this sync
        uint256 deltaIndexRay,      // index bump in RAY (1e27)
        uint256 progressWad,        // x in WAD (1e18): deltaIndexRay / 1e9
        uint256 newJuniorIndexRay,  // juniorIndex after the bump
        uint256 timestamp           // block.timestamp at sync
    );


    // ─────────────── Admin Functions ───────────────

    /// @notice Set the premium percentage for junior notes
    function setJuniorPremium(uint256 newPremiumBps) external onlyOwner {
        require(newPremiumBps <= 10000, "junior: premium > 100%");
        juniorPremiumBps = newPremiumBps;
        emit JuniorParamsSet(newPremiumBps, 0);
    }


    // ─────────────── Bad Debt & Junior Functions ───────────────

    /// @notice Index sync from Reserve inflows (O(1), no loops)
    /// @dev Emits per-sync progress so off-chain can sum to S over a window.
    function _syncReserveToIndex() internal {
        if (juniorIndex == 0) juniorIndex = 1e27;

        address reserveAddr = address(registry.cdpReserve());
        uint256 reserveBal = _usdst().balanceOf(reserveAddr);

        // Nothing new to index
        if (reserveBal <= prevReserveBalance) return;

        uint256 deltaUSDST = reserveBal - prevReserveBalance;
        if (deltaUSDST == 0) {
            prevReserveBalance = reserveBal; // keep accounting consistent
            return;
        }

        uint256 outstanding = totalJuniorOutstandingUSDST;

        // No juniors outstanding: just advance accounting baseline
        if (outstanding == 0) {
            prevReserveBalance = reserveBal;
            return;
        }

        // Convert USDST inflow into an index bump (RAY scale)
        uint256 deltaIndex = (deltaUSDST * RAY) / outstanding;  // RAY
        uint256 newIndex = juniorIndex + deltaIndex;

        // Per-$cap progress fraction x, in WAD (so you can sum to S easily)
        // x = deltaIndex / RAY  => WAD = deltaIndex / (RAY/WAD)
        uint256 progressWad = deltaIndex / (RAY / WAD); // == deltaIndex / 1e9

        // State updates
        juniorIndex = newIndex;
        prevReserveBalance = reserveBal;

        emit JuniorIndexSynced(
            deltaUSDST,
            outstanding,
            deltaIndex,
            progressWad,
            newIndex,
            block.timestamp
        );
    }

    /**
     * @notice Burns USDST to reduce bad debt for an asset, creating a junior note with premium
     * @param asset The asset whose bad debt will be reduced.
     * @param amountUSDST Desired USDST to burn in wei (will be clamped to remaining bad debt).
     * @return burnedUSDST  The actual USDST burned in wei.
     * @return capUSDST     The note's payout cap in wei (principal+premium).
     */
    function openJuniorNote(address asset, uint256 amountUSDST)
        external
        onlyKnownAsset(asset)
        returns (uint256 burnedUSDST, uint256 capUSDST)
    {
        require(amountUSDST > 0, "junior: zero amount");

        uint256 bad = badDebtUSDST[asset];
        require(bad > 0, "junior: no bad debt for asset");

        // Burn and reduce bad debt
        burnedUSDST = amountUSDST > bad ? bad : amountUSDST;
        Token(_usdst()).burn(msg.sender, burnedUSDST);
        badDebtUSDST[asset] = bad - burnedUSDST;
        emit BadDebtRepaid(asset, burnedUSDST, badDebtUSDST[asset]);

        // Cap with premium
        capUSDST = (burnedUSDST * (10000 + juniorPremiumBps)) / 10000;

        // 1) Pull new Reserve inflows into the index first
        _syncReserveToIndex();
        if (juniorIndex == 0) juniorIndex = 1e27;

        // 2) Handle existing note or create new one
        JuniorNote storage note = juniorNotes[msg.sender];
        if (note.owner == address(0)) {
            // Create new note
            juniorNotes[msg.sender] = JuniorNote(msg.sender, capUSDST, juniorIndex);
            totalJuniorOutstandingUSDST += capUSDST;
            emit JuniorNoteCreated(msg.sender, capUSDST);
        } else {
            // Merge new contribution with existing note using blended entry index
            uint256 oldCap = note.capUSDST;
            uint256 oldEntry = note.entryIndex;
            uint256 newCap = oldCap + capUSDST;
            
            // Blended entry = currentIndex - (oldCap/newCap) * (currentIndex - oldEntry)
            uint256 blendedEntry = juniorIndex;
            if (juniorIndex > oldEntry) {
                uint256 indexGrowth = juniorIndex - oldEntry;
                uint256 adjustment = (oldCap * indexGrowth) / newCap;
                blendedEntry = juniorIndex - adjustment;
            }
            
            note.capUSDST = newCap;
            note.entryIndex = blendedEntry;
            totalJuniorOutstandingUSDST += capUSDST;
            
            emit JuniorNoteCreated(msg.sender, newCap);
        }
    }

    /// @notice Calculate entitlement for a note at given index
    function _entitlement(JuniorNote storage note, uint256 idx) internal view returns (uint256) {
        if (note.owner == address(0)) return 0;
        if (note.capUSDST == 0) return 0;
        if (idx == 0) idx = 1e27;

        uint256 last = note.entryIndex;
        if (idx <= last) return 0;

        // Simple: remaining cap earns from its entry point
        uint256 ent = (note.capUSDST * (idx - last)) / 1e27;  // RAY → USDST wei
        if (ent > note.capUSDST) ent = note.capUSDST;  // Cap at remaining cap
        return ent;
    }


    /// @notice View function to show what's claimable for an owner
    function claimable(address owner) public view returns (uint256) {
        JuniorNote storage note = juniorNotes[owner];
        
        // Calculate effective index including unaccounted reserve inflows
        uint256 effectiveIndex = juniorIndex == 0 ? 1e27 : juniorIndex;
        address reserveAddr = address(registry.cdpReserve());
        uint256 reserveBalance = _usdst().balanceOf(reserveAddr);
        
        if (reserveBalance > prevReserveBalance && totalJuniorOutstandingUSDST > 0) {
            uint256 newInflows = reserveBalance - prevReserveBalance;
            uint256 indexBump = (newInflows * 1e27) / totalJuniorOutstandingUSDST;
            effectiveIndex += indexBump;
        }
        
        return _entitlement(note, effectiveIndex);
    }

    function claimJunior() external {
        _syncReserveToIndex();
        JuniorNote storage note = juniorNotes[msg.sender];
        require(note.owner != address(0), "junior: no note");

        uint256 currentIndex = juniorIndex;
        uint256 currentCap = note.capUSDST;

        uint256 entitlement = _entitlement(note, currentIndex);
        require(entitlement > 0, "junior: nothing to claim");

        address reserveAddr = address(registry.cdpReserve());
        uint256 reserveBalance = _usdst().balanceOf(reserveAddr);
        require(reserveBalance > 0, "junior: reserve empty");

        uint256 payAmount = entitlement <= reserveBalance ? entitlement : reserveBalance;
        uint256 unpaidAmount = entitlement - payAmount;
        uint256 newCap = currentCap - payAmount;

        // --- Effects (before interaction) ---
        if (newCap == 0) {
            totalJuniorOutstandingUSDST -= payAmount;
            prevReserveBalance -= payAmount;
            delete juniorNotes[msg.sender].owner;
            delete juniorNotes[msg.sender].capUSDST;
            delete juniorNotes[msg.sender].entryIndex;
            emit JuniorNoteClaimed(msg.sender, payAmount, 0);
            emit JuniorNoteClosed(msg.sender);
        } else {
            // Adjust entry index to preserve unpaid entitlement
            uint256 indexAdjustment = (unpaidAmount == 0) ? 0 : (unpaidAmount * 1e27) / newCap;
            uint256 newEntryIndex = currentIndex - indexAdjustment;

            note.capUSDST = newCap;
            note.entryIndex = newEntryIndex;

            totalJuniorOutstandingUSDST -= payAmount;
            prevReserveBalance -= payAmount;

            emit JuniorNoteClaimed(msg.sender, payAmount, newCap);
        }

        // --- Interaction (after state updates) ---
        CDPReserve(address(registry.cdpReserve())).transferTo(msg.sender, payAmount);
    }

}