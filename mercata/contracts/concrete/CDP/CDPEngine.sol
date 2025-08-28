import "./CDPVault.sol";
import "../Tokens/Token.sol";
import "./PriceOracle.sol";
import "../Admin/FeeCollector.sol";

import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";

contract record CDPEngine is Ownable {
    CDPVault public immutable cdpVault;
    Token public immutable usdst;
    PriceOracle public priceOracle;
    FeeCollector public feeCollector;

    struct CollateralConfig {
        uint256 liquidationRatio;
        uint256 liquidationPenaltyBps;
        uint256 closeFactorBps;
        uint256 stabilityFeeRate;
        uint256 debtFloor;
        uint256 debtCeiling;
        uint256 unitScale;
        bool isPaused;
    }

    struct CollateralGlobalState {
        uint256 rateAccumulator;
        uint256 lastAccrual;
        uint256 totalScaledDebt;
        uint256 mintedUSD;
    }

    struct Vault {
        uint256 collateral;
        uint256 scaledDebt;
    }

    mapping(address => CollateralConfig) public record collateralConfigs;
    mapping(address => CollateralGlobalState) public record collateralGlobalStates;
    mapping(address => mapping(address => Vault)) public record vaults; // user => asset => vault

    bool public globalPaused;
    uint256 public constant RAY = 1e27;
    uint256 public constant WAD = 1e18;
    address[] public record supportedAssets;
    mapping(address => bool) public record isSupportedAsset;

    // Events
    event CollateralConfigured(
        address indexed asset,
        uint256 liquidationRatio,
        uint256 liquidationPenaltyBps,
        uint256 closeFactorBps,
        uint256 stabilityFeeRate,
        uint256 debtFloor,
        uint256 debtCeiling,
        uint256 unitScale
    );

    event Accrued(
        address indexed asset,
        uint256 oldRate,
        uint256 newRate,
        uint256 deltaTime
    );

    event Deposited(
        address indexed owner,
        address indexed asset,
        uint256 amount
    );

    event Withdrawn(
        address indexed owner,
        address indexed asset,
        uint256 amount
    );

    event USDSTMinted(
        address indexed owner,
        address indexed asset,
        uint256 amountUSD
    );

    event USDSTBurned(
        address indexed owner,
        address indexed asset,
        uint256 amountUSD
    );

    event Liquidation(
        address indexed borrower,
        address indexed asset,
        uint256 debtBurnedUSD,
        uint256 penaltyUSD,
        uint256 collateralOut,
        address indexed liquidator
    );

    event Paused(address indexed asset, bool isPaused);
    event PausedGlobal(bool isPaused);
    
    event VaultUpdated(
        address indexed user,
        address indexed asset,
        uint256 collateral,
        uint256 scaledDebt
    );

    // Modifiers
    modifier whenNotPaused(address asset) {
        require(!globalPaused, "CDPEngine: global pause");
        require(!collateralConfigs[asset].isPaused, "CDPEngine: asset paused");
        _;
    }

    modifier onlySupportedAsset(address asset) {
        require(isSupportedAsset[asset], "CDPEngine: unsupported asset");
        _;
    }

    constructor(
        address _cdpVault,
        address _usdst,
        address _priceOracle,
        address _feeCollector,
        address initialOwner
    ) Ownable(initialOwner) {
        require(_cdpVault != address(0), "CDPEngine: invalid vault");
        require(_usdst != address(0), "CDPEngine: invalid USDST");
        require(_priceOracle != address(0), "CDPEngine: invalid oracle");
        
        cdpVault = CDPVault(_cdpVault);
        usdst = Token(_usdst);
        priceOracle = PriceOracle(_priceOracle);
        feeCollector = FeeCollector(_feeCollector);
    }


    function deposit(
        address asset,
        uint256 amount
    ) external whenNotPaused(asset) onlySupportedAsset(asset) {
        require(amount > 0, "CDPEngine: Invalid amount");

        cdpVault.deposit(msg.sender, asset, amount);

        // Update vault state
        vaults[msg.sender][asset].collateral += amount;

        emit Deposited(msg.sender, asset, amount);
    }

    /**
     * @notice Withdraw collateral from vault
     * @param asset The collateral asset
     * @param amount The amount to withdraw
     */
    function withdraw(
        address asset,
        uint256 amount
    ) external whenNotPaused(asset) onlySupportedAsset(asset) {
        require(amount > 0, "CDPEngine: Invalid amount");
        
        Vault storage vault = vaults[msg.sender][asset];

        require(vault.collateral >= amount, "CDPEngine: Insufficient collateral");

        _accrue(asset);

        vault.collateral -= amount;

        if (vault.scaledDebt > 0) {
            uint256 crAfter = collateralizationRatio(msg.sender, asset);
            require(crAfter >= collateralConfigs[asset].liquidationRatio, "CDPEngine: Undercollateralized");
        }

        cdpVault.withdraw(msg.sender, asset, amount);

        emit Withdrawn(msg.sender, asset, amount);
    }

    /**
     * @notice Withdraw maximum safe amount of collateral
     * @param asset The collateral asset
     * @return maxAmount The maximum amount withdrawn
     */
    function withdrawMax(
        address asset
    ) external whenNotPaused(asset) onlySupportedAsset(asset) returns (uint256 maxAmount) {
        _accrue(asset);

        Vault storage vault = vaults[msg.sender][asset];
        uint256 debt = (vault.scaledDebt * collateralGlobalStates[asset].rateAccumulator) / RAY;

        if (debt == 0) {
            // No debt, can withdraw all collateral
            maxAmount = vault.collateral;
        } else {
            // Calculate required collateral to maintain liquidation ratio
            uint256 price = priceOracle.getAssetPrice(asset);
            CollateralConfig memory config = collateralConfigs[asset];
            
            uint256 requiredCollateralValue = (debt * config.liquidationRatio) / WAD;
            uint256 requiredCollateral = (requiredCollateralValue * config.unitScale) / price;
            
            if (vault.collateral > requiredCollateral) {
                maxAmount = vault.collateral - requiredCollateral;
                // Apply 1 wei buffer for safety
                if (maxAmount > 1) {
                    maxAmount -= 1;
                }
            } else {
                maxAmount = 0;
            }
        }

        if (maxAmount > 0) {
            vault.collateral -= maxAmount;
            cdpVault.withdraw(msg.sender, asset, maxAmount);
            emit Withdrawn(msg.sender, asset, maxAmount);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Get vault data for a user
     * @param owner The vault owner
     * @param asset The collateral asset
     * @return collateral The collateral amount
     * @return scaledDebt The scaled debt amount
     */
    function getVault(
        address owner,
        address asset
    ) external view returns (uint256 collateral, uint256 scaledDebt) {
        Vault memory vault = vaults[owner][asset];
        return (vault.collateral, vault.scaledDebt);
    }

    /**
     * @notice Get current debt in USD for a user's vault
     * @param owner The vault owner
     * @param asset The collateral asset
     * @return Current debt in USD (WAD)
     */
    function debtUSD(
        address owner,
        address asset
    ) external view returns (uint256) {
        Vault memory vault = vaults[owner][asset];
        if (vault.scaledDebt == 0) return 0;

        // Use fresh rate accumulator (with accrued interest)
        (, uint256 rateAccumulatorFresh) = previewAccrual(asset);
        return (vault.scaledDebt * rateAccumulatorFresh) / RAY;
    }

    /**
     * @notice Get collateral value in USD for a user's vault
     * @param owner The vault owner
     * @param asset The collateral asset
     * @return Collateral value in USD (WAD)
     */
    function collateralValueUSD(
        address owner,
        address asset
    ) public view returns (uint256) {
        Vault memory vault = vaults[owner][asset];
        CollateralConfig memory assetConfig = collateralConfigs[asset];
        
        uint256 price = priceOracle.getAssetPrice(asset); // USD 1e18
        require(price > 0, "CDPEngine: invalid price");
        
        return (vault.collateral * price) / assetConfig.unitScale;
    }

    /**
     * @notice Get collateralization ratio for a user's vault
     * @param owner The vault owner
     * @param asset The collateral asset
     * @return Collateralization ratio in WAD (1e18 = 100%)
     */
    function collateralizationRatio(
        address owner,
        address asset
    ) external view returns (uint256) {
        Vault memory vault = vaults[owner][asset];
        
        if (vault.scaledDebt == 0) return type(uint256).max; // Undefined/∞ if no debt
        
        // Use fresh rate accumulator for accurate debt calculation
        (, uint256 rateAccumulatorFresh) = previewAccrual(asset);
        uint256 debtUSD = (vault.scaledDebt * rateAccumulatorFresh) / RAY;
        
        uint256 collateralValueUSD_calc = collateralValueUSD(owner, asset);
        return (collateralValueUSD_calc * WAD) / debtUSD;
    }

    /**
     * @notice Preview what the rate accumulator would be after accruing interest
     * @param asset The asset to preview accrual for
     * @return dt Time elapsed since last accrual
     * @return rateAccumulatorNext Updated rate accumulator with accrued interest
     */
    function previewAccrual(
        address asset
    ) public view returns (uint256 dt, uint256 rateAccumulatorNext) {
        CollateralConfig memory assetConfig = collateralConfigs[asset];
        CollateralGlobalState memory assetState = collateralGlobalStates[asset];
        
        // Handle first time initialization
        if (assetState.lastAccrual == 0) {
            return (0, RAY);
        }
        
        dt = block.timestamp - assetState.lastAccrual;
        if (dt == 0) {
            return (0, assetState.rateAccumulator);
        }
        
        uint256 factor = _rpow(assetConfig.stabilityFeeRate, dt, RAY);
        rateAccumulatorNext = (assetState.rateAccumulator * factor) / RAY;
    }

     
    function mint(address asset, uint256 amountUSD) external whenNotPaused(asset) onlySupportedAsset(asset) {
        require(amountUSD > 0, "CDPEngine: zero amount");
        _accrue(asset);
        
        CollateralConfig memory assetConfig = collateralConfigs[asset];
        CollateralGlobalState storage assetState = collateralGlobalStates[asset];
        Vault storage userVault = vaults[msg.sender][asset];
        
        if (assetConfig.debtCeiling > 0) {
            require(assetState.mintedUSD + amountUSD <= assetConfig.debtCeiling, "CDPEngine: debt ceiling exceeded");
        }
        
        uint256 scaledAdd = (amountUSD * RAY) / assetState.rateAccumulator; // RAY = 1e27
        userVault.scaledDebt += scaledAdd;
        assetState.totalScaledDebt += scaledAdd;
        
        uint256 totalDebtAfter = (userVault.scaledDebt * assetState.rateAccumulator) / RAY;
        if (assetConfig.debtFloor > 0) {
            require(totalDebtAfter >= assetConfig.debtFloor, "CDPEngine: below debt floor");
        }

        require(collateralizationRatio(msg.sender, asset) >= assetConfig.liquidationRatio, "CDPEngine: insufficient collateral");
        assetState.mintedUSD += amountUSD;
        
        require(usdst.mint(msg.sender, amountUSD), "CDPEngine: mint failed");
        
        emit USDSTMinted(msg.sender, asset, amountUSD);
        emit VaultUpdated(msg.sender, asset, userVault.collateral, userVault.scaledDebt);
    }

    /**
     * @notice Repay USDST debt for a specific asset
     * @param asset The collateral asset 
     * @param amountUSD The amount of USDST to repay
     * @dev User must first approve(CDPEngine, amountUSD) before calling this
     */
    function repay(address asset, uint256 amountUSD) external whenNotPaused(asset) onlySupportedAsset(asset) {
        _accrue(asset);
        require(amountUSD > 0, "CDPEngine: zero amount");
        
        CollateralGlobalState storage assetState = collateralGlobalStates[asset];
        Vault storage userVault = vaults[msg.sender][asset];
        
        uint256 owed = (userVault.scaledDebt * assetState.rateAccumulator) / RAY;
        require(owed > 0, "CDPEngine: no debt");
        uint256 repay = amountUSD > owed ? owed : amountUSD;
        uint256 scaledDelta = (repay * RAY) / assetState.rateAccumulator;
        
        // Clamp scaledDelta to not exceed current scaledDebt (handle rounding)
        if (scaledDelta > userVault.scaledDebt) {
            scaledDelta = userVault.scaledDebt;
        }
        
        require(usdst.burn(msg.sender, repay), "CDPEngine: burn failed");

        userVault.scaledDebt -= scaledDelta;
        assetState.totalScaledDebt -= scaledDelta;
        assetState.mintedUSD -= repay;
        
        emit USDSTBurned(msg.sender, asset, repay);
        emit VaultUpdated(msg.sender, asset, userVault.collateral, userVault.scaledDebt);
    }

    /**
     * @notice Repay all debt for a specific asset (dust-free)
     * @param asset The collateral asset
     * @dev Consumes rounding residual to set scaledDebt=0 exactly
     */
    function repayAll(address asset) external whenNotPaused(asset) onlySupportedAsset(asset) {
        _accrue(asset);
        
        CollateralGlobalState storage assetState = collateralGlobalStates[asset];
        Vault storage userVault = vaults[msg.sender][asset];
        
        require(userVault.scaledDebt > 0, "CDPEngine: no debt");
        uint256 owed = (userVault.scaledDebt * assetState.rateAccumulator) / RAY;
        uint256 scaledDebtToRemove = userVault.scaledDebt;
        
        require(usdst.burn(msg.sender, owed), "CDPEngine: burn failed");

        // Fully clear scaledDebt regardless of rounding
        userVault.scaledDebt = 0;
        assetState.totalScaledDebt -= scaledDebtToRemove;
        assetState.mintedUSD -= owed;
        
        emit USDSTBurned(msg.sender, asset, owed);
        emit VaultUpdated(msg.sender, asset, userVault.collateral, userVault.scaledDebt);
    }

    /**
    * @notice Liquidate an unhealthy position
    * @param collateralAsset The collateral asset to seize
    * @param borrower The address of the borrower being liquidated
    * @param debtToCover Amount of USDST debt the liquidator is repaying
    * Requirements:
    *  - Borrower collateralization ratio must be below liquidation threshold
    *  - Liquidator can repay up to the close factor percentage of outstanding debt
    */
    function liquidationCall(
        address collateralAsset,
        address borrower,
        uint256 debtToCover
    ) external whenNotPaused(collateralAsset) onlySupportedAsset(collateralAsset) {
        require(borrower != address(0) && borrower != msg.sender, "CDPEngine: invalid borrower");
        require(debtToCover > 0, "CDPEngine: zero debt amount");
        _accrue(collateralAsset);

        CollateralConfig memory config = collateralConfigs[collateralAsset];
        CollateralGlobalState storage assetState = collateralGlobalStates[collateralAsset];
        Vault storage borrowerVault = vaults[borrower][collateralAsset];

        require(borrowerVault.scaledDebt > 0, "CDPEngine: no debt to liquidate");

        // Check if position is liquidatable
        uint256 borrowerCR = collateralizationRatio(borrower, collateralAsset);
        require(borrowerCR < config.liquidationRatio, "CDPEngine: position healthy");

        uint256 totalDebt = (borrowerVault.scaledDebt * assetState.rateAccumulator) / RAY;
        
        // Apply close factor - liquidator can repay up to closeFactorBps% of debt
        uint256 maxRepayable = (totalDebt * config.closeFactorBps) / 10000;
        require(debtToCover <= maxRepayable, "CDPEngine: exceeds close factor");

        require(usdst.burn(msg.sender, debtToCover), "CDPEngine: burn failed");

        // Reduce borrower's debt
        uint256 scaledDebtReduction = (debtToCover * RAY) / assetState.rateAccumulator;
        if (scaledDebtReduction > borrowerVault.scaledDebt) {
            scaledDebtReduction = borrowerVault.scaledDebt;
        }
        
        borrowerVault.scaledDebt -= scaledDebtReduction;
        assetState.totalScaledDebt -= scaledDebtReduction;
        assetState.mintedUSD -= debtToCover;

        // Calculate collateral to seize (debt + penalty)
        uint256 collateralPrice = priceOracle.getAssetPrice(collateralAsset);
        require(collateralPrice > 0, "CDPEngine: invalid collateral price");
        
        // Penalty amount in USD
        uint256 penaltyUSD = (debtToCover * config.liquidationPenaltyBps) / 10000;
        uint256 totalSeizureUSD = debtToCover + penaltyUSD;
        uint256 collateralToSeize = (totalSeizureUSD * config.unitScale) / collateralPrice;
        
        // Cap seizure to available collateral
        if (collateralToSeize > borrowerVault.collateral) {
            collateralToSeize = borrowerVault.collateral;
        }

        require(collateralToSeize > 0, "CDPEngine: no collateral to seize");
        borrowerVault.collateral -= collateralToSeize;
        cdpVault.seize(borrower, collateralAsset, msg.sender, collateralToSeize);

        emit Liquidation(
            borrower,
            collateralAsset,
            debtToCover,
            penaltyUSD,
            collateralToSeize,
            msg.sender
        );
        
        emit VaultUpdated(borrower, collateralAsset, borrowerVault.collateral, borrowerVault.scaledDebt);
    }

    /**
     * @notice Accrue interest for a specific asset
     * @param asset The asset to accrue interest for
     */
    function _accrue(address asset) internal {
        CollateralConfig memory assetConfig = collateralConfigs[asset];
        CollateralGlobalState storage assetState = collateralGlobalStates[asset];
        
        // Initialize if first time
        if (assetState.lastAccrual == 0) {
            assetState.lastAccrual = block.timestamp;
            assetState.rateAccumulator = RAY;
            return;
        }
        
        uint256 dt = block.timestamp - assetState.lastAccrual;
        if (dt == 0) return; // No time elapsed
        
        uint256 oldRate = assetState.rateAccumulator;
        
        uint256 factor = _rpow(assetConfig.stabilityFeeRate, dt, RAY);
        assetState.rateAccumulator = (oldRate * factor) / RAY;
        assetState.lastAccrual = block.timestamp;
        
        emit Accrued(asset, oldRate, assetState.rateAccumulator, dt);
    }





    /**
     * @notice Efficient integer exponentiation (from Maker's math library) https://github.com/sky-ecosystem/dss/blob/fa4f6630afb0624d04a003e920b0d71a00331d98/src/jug.sol#L62
     * @param x Base in RAY
     * @param n Exponent
     * @param base Ray base (1e27)
     * @return z Result in RAY
     */
    function _rpow(uint256 x, uint256 n, uint256 base) internal pure returns (uint256 z) {
        assembly {
            switch x case 0 {switch n case 0 {z := base} default {z := 0}}
            default {
                switch mod(n, 2) case 0 { z := base } default { z := x }
                let half := div(base, 2)  // for rounding.
                for { n := div(n, 2) } n { n := div(n,2) } {
                    let xx := mul(x, x)
                    if iszero(eq(div(xx, x), x)) { revert(0,0) }
                    let xxRound := add(xx, half)
                    if iszero(gte(xxRound, xx)) { revert(0,0) }
                    x := div(xxRound, base)
                    if mod(n,2) {
                        let zx := mul(z, x)
                        if and(iszero(iszero(x)), iszero(eq(div(zx, x), z))) { revert(0,0) }
                        let zxRound := add(zx, half)
                        if iszero(gte(zxRound, zx)) { revert(0,0) }
                        z := div(zxRound, base)
                    }
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // ADMINISTRATIVE FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Configure risk parameters for a collateral asset
     * @param asset The collateral asset address
     * @param liquidationRatio Minimum collateralization ratio (WAD)
     * @param liquidationPenaltyBps Penalty for liquidation in basis points
     * @param closeFactorBps Maximum liquidation amount in basis points
     * @param stabilityFeeRate Per-second stability fee rate (RAY)
     * @param debtFloor Minimum debt amount to avoid dust
     * @param debtCeiling Maximum debt amount for this asset
     * @param unitScale Scale factor for non-18 decimal tokens
     */
    function setCollateralAssetParams(
        address asset,
        uint256 liquidationRatio,
        uint256 liquidationPenaltyBps,
        uint256 closeFactorBps,
        uint256 stabilityFeeRate,
        uint256 debtFloor,
        uint256 debtCeiling,
        uint256 unitScale
    ) external onlyOwner {
        require(asset != address(0), "CDPEngine: invalid asset");
        require(liquidationRatio > WAD, "CDPEngine: liquidation ratio too low");
        require(liquidationPenaltyBps <= 10000, "CDPEngine: penalty too high");
        require(closeFactorBps <= 10000, "CDPEngine: close factor too high");
        require(unitScale > 0, "CDPEngine: invalid unit scale");

        CollateralConfig storage config = collateralConfigs[asset];
        config.liquidationRatio = liquidationRatio;
        config.liquidationPenaltyBps = liquidationPenaltyBps;
        config.closeFactorBps = closeFactorBps;
        config.stabilityFeeRate = stabilityFeeRate;
        config.debtFloor = debtFloor;
        config.debtCeiling = debtCeiling;
        config.unitScale = unitScale;

        if (!isSupportedAsset[asset]) {
            isSupportedAsset[asset] = true;
            supportedAssets.push(asset);
        }

        emit CollateralConfigured(
            asset,
            liquidationRatio,
            liquidationPenaltyBps,
            closeFactorBps,
            stabilityFeeRate,
            debtFloor,
            debtCeiling,
            unitScale
        );
    }

    /**
     * @notice Set pause state for a specific asset
     * @param asset The asset to pause/unpause
     * @param isPaused Whether the asset should be paused
     */
    function setPaused(address asset, bool isPaused) external onlyOwner {
        require(isSupportedAsset[asset], "CDPEngine: unsupported asset");
        collateralConfigs[asset].isPaused = isPaused;
        emit Paused(asset, isPaused);
    }

    /**
     * @notice Set global pause state
     * @param isPaused Whether the system should be globally paused
     */
    function setPausedGlobal(bool isPaused) external onlyOwner {
        globalPaused = isPaused;
        emit PausedGlobal(isPaused);
    }

    /**
     * @notice Update PriceOracle reference
     * @param _priceOracle New price oracle address
     */
    function setPriceOracle(address _priceOracle) external onlyOwner {
        require(_priceOracle != address(0), "CDPEngine: invalid oracle");
        priceOracle = PriceOracle(_priceOracle);
    }

    /**
     * @notice Update FeeCollector reference
     * @param _feeCollector New fee collector address
     */
    function setFeeCollector(address _feeCollector) external onlyOwner {
        require(_feeCollector != address(0), "CDPEngine: invalid fee collector");
        feeCollector = FeeCollector(_feeCollector);
    }
}
