// CDPEngine
// - Core CDP logic for multi‑collateral USDST mint/burn
// - Tracks per‑asset risk configs and per‑vault state (collateral, scaledDebt)
// - Accrues stability fee via rateAccumulator (RAY); all debt reads use scaledDebt * rate / RAY
// - Single liquidation entrypoint caps repay to min(requested, debt, close-factor, coverage incl. penalty)

import "./CDPVault.sol";
import "../Tokens/Token.sol";
import "../Tokens/TokenFactory.sol";
import "../Lending/PriceOracle.sol";
import "./CDPRegistry.sol";
import "../Admin/FeeCollector.sol";

import "../../abstract/ERC20/access/Ownable.sol";

contract record CDPEngine is Ownable {
    // Registry and shared components resolved from the registry
    CDPRegistry public registry;
    // Resolve Token, TokenFactory, and FeeCollector via registry at call time

    // Per‑asset configuration (see setCollateralAssetParams)
    struct CollateralConfig {
        uint liquidationRatio;          // WAD (e.g. 1.50e18)
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
    mapping(address => uint) public badDebtUSD; // 1e18, bad debt (per-asset), non-accruing

    bool public globalPaused;
    uint public RAY = 1e27;
    uint public WAD = 1e18;
    mapping(address => bool) public record isSupportedAsset;

    // Events (post‑state metrics where relevant)
    event CollateralConfigured(
        address indexed asset,
        uint liquidationRatio,
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

    /**
     * @notice Emitted after a successful liquidation (direct seize, no auction)
     * @param borrower Vault owner being liquidated
     * @param asset Collateral asset
     * @param debtBurnedUSD Debt repaid by liquidator (USD 1e18)
     * @param penaltyUSD Penalty applied to the liquidation (USD 1e18), realized via extra collateral seized (not minted)
     * @param collateralOut Collateral amount sent to liquidator
     * @param liquidator Caller who executed liquidation
     * @param remainingDebtUSD Borrower debt after update
     * @param rateAccumulator Current per‑asset rate accumulator (RAY)
     */
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
        require(TokenFactory(_tokenFactory()).isTokenActive(asset), "inactive");
        _;
    }
    
    // ─────────────────────────────── Constructor ─────────────────────────────
    constructor(
        address _registry,
        address initialOwner
    ) Ownable(initialOwner) {
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

    // ───────────────────────────── User Actions ──────────────────────────────
    /**
     * @notice Deposit collateral from msg.sender into their vault
     * @dev Pulls tokens via transferFrom into CDPVault custody; emits Deposited and VaultUpdated
     */
    function deposit(address asset, uint amount) external whenNotPaused(asset) onlyActiveAsset(asset) {
        require(amount > 0, "CDPEngine: Invalid amount");
        // Move collateral into vault custody and update in-memory vault balance
        CDPVault(_cdpVault()).deposit(msg.sender, asset, amount);
        vaults[msg.sender][asset].collateral += amount;
        emit Deposited(msg.sender, asset, amount);
        emit VaultUpdated(msg.sender, asset, vaults[msg.sender][asset].collateral, vaults[msg.sender][asset].scaledDebt);
    }

    /**
     * @notice Withdraw explicit amount of collateral; requires CR ≥ LR when debt > 0
     * @dev Accrues first; reverts if resulting CR would fall below liquidationRatio
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
            require(crAfter >= collateralConfigs[asset].liquidationRatio, "CDPEngine: Undercollateralized");
        }
        // Perform custody move after checks
        CDPVault(_cdpVault()).withdraw(msg.sender, asset, amount);
        emit Withdrawn(msg.sender, asset, amount);
        emit VaultUpdated(msg.sender, asset, vault.collateral, vault.scaledDebt);
    }

    /**
     * @notice Withdraw maximum safe collateral while preserving CR ≥ LR
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
            // Compute collateral required to keep CR >= LR
            uint price = PriceOracle(_cdpPriceOracle()).getAssetPrice(asset);
            require(price > 0, "invalid price");
            CollateralConfig memory config = collateralConfigs[asset];
            uint requiredCollateralValue = (debt * config.liquidationRatio) / WAD;
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
            CDPVault(_cdpVault()).withdraw(msg.sender, asset, maxAmount);
            emit Withdrawn(msg.sender, asset, maxAmount);
            emit VaultUpdated(msg.sender, asset, vault.collateral, vault.scaledDebt);
        }
    }

    /**
     * @notice Mint a specific amount of USDST against collateral
     * @dev Checks debtCeiling and debtFloor, accrues first, and updates scaled debt and books
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
        // Value collateral in USD and compute borrow headroom from LR
        uint price = PriceOracle(_cdpPriceOracle()).getAssetPrice(asset);
        require(price > 0, "invalid price");
        uint collateralValueUSD_calc = (userVault.collateral * price) / assetConfig.unitScale;
        uint maxBorrowableUSD = (collateralValueUSD_calc * WAD) / assetConfig.liquidationRatio;
        require(currentDebt + amountUSD < maxBorrowableUSD, "CDPEngine: insufficient collateral");
        // Enforce per-asset debt ceiling vs current outstanding debt (Maker-style)
        if (assetConfig.debtCeiling > 0) {
            uint assetDebtUSD = (assetState.totalScaledDebt * assetState.rateAccumulator) / RAY;
            require(assetDebtUSD + amountUSD <= assetConfig.debtCeiling, "CDPEngine: debt ceiling exceeded");
        }       
        // Increase scaled debt (principal) using current index
        uint scaledAdd = (amountUSD * RAY) / assetState.rateAccumulator;
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
     * @dev Computes headroom from CR and LR, enforces ceiling/floor, and mints to user
     */
    function mintMax(address asset) external whenNotPaused(asset) onlyActiveAsset(asset) returns (uint amountMinted) {
        // Accrue to make the index current
        _accrue(asset);
        CollateralConfig memory config = collateralConfigs[asset];
        CollateralGlobalState storage assetState = collateralGlobalStates[asset];
        Vault storage userVault = vaults[msg.sender][asset];
        // Current owed in USD
        uint currentDebt = (userVault.scaledDebt * assetState.rateAccumulator) / RAY;
        // Compute borrow headroom from collateral value and LR
        uint price = PriceOracle(_cdpPriceOracle()).getAssetPrice(asset);
        require(price > 0, "invalid price");
        uint collateralValueUSD_calc = (userVault.collateral * price) / config.unitScale;
        uint maxBorrowableUSD = (collateralValueUSD_calc * WAD) / config.liquidationRatio;
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
        uint scaledAdd = (amountMinted * RAY) / assetState.rateAccumulator;
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
        if (feeUSD > 0) Token(_usdst()).mint(address(_feeCollector()), feeUSD);

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
        // Route fee to FeeCollector in USDST; principal reduction reflected in books below
        if (feeUSD > 0) { Token(_usdst()).mint(address(_feeCollector()), feeUSD); }
        // Zero vault scaled debt and update global totals/books
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
    * @param debtToCover Desired repay amount in USD (WAD, 18 decimals)
    */
    function liquidate(
        address collateralAsset,
        address borrower,
        uint debtToCover
    ) external onlyKnownAsset(collateralAsset) {
        // Basic checks
        require(borrower != address(0) && borrower != msg.sender, "CDPEngine: invalid borrower");
        require(debtToCover > 0, "CDPEngine: zero debt amount");

        // Accrue for this asset
        _accrue(collateralAsset);

        // Load config/state and assert unhealthy
        CollateralConfig memory config = collateralConfigs[collateralAsset];
        CollateralGlobalState storage assetState = collateralGlobalStates[collateralAsset];
        Vault storage borrowerVault = vaults[borrower][collateralAsset];
        require(borrowerVault.scaledDebt > 0, "CDPEngine: no debt to liquidate");

        uint borrowerCR = collateralizationRatio(borrower, collateralAsset);
        require(borrowerCR < config.liquidationRatio, "CDPEngine: position healthy");

        // Prices & caps
        uint priceColl = PriceOracle(_cdpPriceOracle()).getAssetPrice(collateralAsset);
        require(priceColl > 0, "CDPEngine: invalid collateral price");

        uint totalDebtUSD   = (borrowerVault.scaledDebt * assetState.rateAccumulator) / RAY;
        uint closeFactorCap = (totalDebtUSD * config.closeFactorBps) / 10000;

        // Collateral USD value and coverage cap INCLUDING penalty
        uint collateralUSD = (borrowerVault.collateral * priceColl) / config.unitScale;
        // Ensure repay + penalty can be paid fully in collateral:
        // repay <= collateralUSD * 10000 / (10000 + penaltyBps)
        uint coverageCap = (collateralUSD * 10000) / (10000 + config.liquidationPenaltyBps);

        // Repay amount capped by all constraints
        uint repay = debtToCover;
        if (repay > totalDebtUSD)   repay = totalDebtUSD;
        if (repay > closeFactorCap) repay = closeFactorCap;
        if (repay > coverageCap)    repay = coverageCap;
        require(repay > 0, "CDPEngine: nothing to liquidate");

        // Convert to scaled and clamp (rounding may reduce extinguished USD below `repay`)
        uint scaledDebtToLiquidate = (repay * RAY) / assetState.rateAccumulator;
        if (scaledDebtToLiquidate > borrowerVault.scaledDebt) {
            scaledDebtToLiquidate = borrowerVault.scaledDebt;
        }

        // Debt actually extinguished at current index (EXACT amount to burn)
        uint owedForDelta = (scaledDebtToLiquidate * assetState.rateAccumulator) / RAY;
        uint baseUSD = scaledDebtToLiquidate; // normalized principal extinguished
        uint feeUSD  = owedForDelta > baseUSD ? (owedForDelta - baseUSD) : 0;

        // Burn exact, route fee, update books
        Token(_usdst()).burn(msg.sender, owedForDelta);
        if (feeUSD > 0) {
            Token(_usdst()).mint(address(_feeCollector()), feeUSD);
        }
        borrowerVault.scaledDebt -= scaledDebtToLiquidate;
        assetState.totalScaledDebt -= scaledDebtToLiquidate;

        // Seize collateral for (repay + penalty) based on actual burned amount
        uint penaltyUSD = (owedForDelta * config.liquidationPenaltyBps) / 10000;
        uint debtWithPenaltyUSD = owedForDelta + penaltyUSD;

        uint collateralToSeize = (debtWithPenaltyUSD * config.unitScale) / priceColl;
        if (collateralToSeize > borrowerVault.collateral) {
            collateralToSeize = borrowerVault.collateral;
        }

        borrowerVault.collateral -= collateralToSeize;
        CDPVault(_cdpVault()).seize(borrower, collateralAsset, msg.sender, collateralToSeize);

        // Events & dust cleanup
        uint remainingDebtUSD = (borrowerVault.scaledDebt * assetState.rateAccumulator) / RAY;
        emit LiquidationExecuted(
            borrower,
            collateralAsset,
            owedForDelta,            // actual debt burned
            penaltyUSD,
            collateralToSeize,
            msg.sender,
            remainingDebtUSD,
            assetState.rateAccumulator
        );

        // Realize bad debt if no collateral remains but debt still > 1 wei
        if (borrowerVault.collateral == 0) {
            uint rem = (borrowerVault.scaledDebt * assetState.rateAccumulator) / RAY;
            if (rem > 1) {
                // remove from books
                assetState.totalScaledDebt -= borrowerVault.scaledDebt;
                borrowerVault.scaledDebt = 0;
                // make explicit, non-accruing
                badDebtUSD[collateralAsset] += rem;
                emit BadDebtRealized(collateralAsset, borrower, rem);
            }
        } else {
          emit VaultUpdated(borrower, collateralAsset, borrowerVault.collateral, borrowerVault.scaledDebt);
        }
        
        // If ≤ 1 wei debt remains, zero it out in normalized units
        if (remainingDebtUSD <= 1) {
            if (borrowerVault.scaledDebt > 0) {
                assetState.totalScaledDebt -= borrowerVault.scaledDebt;
                borrowerVault.scaledDebt = 0;
            }
        }
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
        // First-time init: set baseline index and lastAccrual
        if (assetState.lastAccrual == 0) { assetState.lastAccrual = block.timestamp; assetState.rateAccumulator = RAY; return; }
        // If no time elapsed since last accrual, skip
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
     * @dev Validates bounds for LR, penalty, close-factor, rate, floor/ceiling, and unitScale
     */
    function setCollateralAssetParams(
        address asset,
        uint liquidationRatio,
        uint liquidationPenaltyBps,
        uint closeFactorBps,
        uint stabilityFeeRate,
        uint debtFloor,
        uint debtCeiling,
        uint unitScale,
        bool pause
    ) public onlyOwner {
        require(asset != address(0), "CDPEngine: invalid asset");
        require(liquidationRatio >= WAD, "CDPEngine: liquidation ratio too low");
        require(liquidationPenaltyBps >= 500 && liquidationPenaltyBps <= 3000, "penalty out of range");
        require(closeFactorBps >= 5000 && closeFactorBps <= 10000, "CDPEngine: close factor out of range");
        require(stabilityFeeRate >= RAY, "CDPEngine: stability fee too low");
        require(unitScale > 0, "CDPEngine: invalid unit scale");
        if (debtCeiling > 0) { require(debtFloor <= debtCeiling, "CDPEngine: debt floor above ceiling"); }
        CollateralConfig storage config = collateralConfigs[asset];
        config.liquidationRatio = liquidationRatio; 
        config.liquidationPenaltyBps = liquidationPenaltyBps; 
        config.closeFactorBps = closeFactorBps; 
        config.stabilityFeeRate = stabilityFeeRate; 
        config.debtFloor = debtFloor; 
        config.debtCeiling = debtCeiling; 
        config.unitScale = unitScale;
        config.isPaused = pause;
        if (!isSupportedAsset[asset]) { isSupportedAsset[asset] = true; }
        emit CollateralConfigured(asset, liquidationRatio, liquidationPenaltyBps, closeFactorBps, stabilityFeeRate, debtFloor, debtCeiling, unitScale, pause);
    }

    /**
     * @notice Batch configure multiple collateral assets in one transaction
     * @dev All arrays must have equal non-zero length N; i-th entries map to the same asset
     */
    function setCollateralAssetParamsBatch(
        address[] calldata assets,
        uint[] calldata liquidationRatios,
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
            // Reuse existing validation/events via the single-asset setter
            setCollateralAssetParams(
                assets[i],
                liquidationRatios[i],
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
        uint price = PriceOracle(_cdpPriceOracle()).getAssetPrice(asset);
        require(price > 0, "invalid price");
        uint unitScale = collateralConfigs[asset].unitScale;
        uint collateralUSD = unitScale == 0 ? 0 : (v.collateral * price) / unitScale;
        return (collateralUSD * WAD) / debtUSD;
    }
}