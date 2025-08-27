import "./CDPVault.sol";
import "../Tokens/Token.sol";
import "./PriceOracle.sol";
import "../Admin/FeeCollector.sol";

import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";

contract record CDPEngine is Ownable {
    // External contracts
    CDPVault public immutable cdpVault;
    Token public immutable usdst;
    PriceOracle public priceOracle;
    FeeCollector public feeCollector;

    // Per-collateral asset Risk Parameters
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

    // Global state per collateral
    struct CollateralGlobalState {
        uint256 rateAccumulator;
        uint256 lastAccrual;
        uint256 totalScaledDebt;
        uint256 mintedUSD;
    }

    // Vault state per user per asset
    struct Vault {
        uint256 collateral;
        uint256 scaledDebt;
    }

    mapping(address => CollateralConfig) public record collateralConfigs;
    mapping(address => CollateralGlobalState) public record collateralGlobalStates;
    mapping(address => mapping(address => Vault)) public record vaults; // user => asset => vault

    bool public globalPaused;
    uint256 public RAY = 1e27;
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

    event LiquidationExecuted(
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

        require(_collateralizationRatio(msg.sender, asset) >= assetConfig.liquidationRatio, "CDPEngine: insufficient collateral");
        assetState.mintedUSD += amountUSD;
        
        ERC20 usdst = ERC20(address(usdst));
        usdst.mint(msg.sender, amountUSD);
        
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
     * @notice Calculate collateralization ratio for a user's vault
     * @param user The user address
     * @param asset The collateral asset
     * @return The collateralization ratio in WAD (1e18)
     */
    function _collateralizationRatio(address user, address asset) internal view returns (uint256) {
        Vault memory vault = vaults[user][asset];
        CollateralGlobalState memory assetState = collateralGlobalStates[asset];
        
        // Per outline: debtUSD = scaledDebt * rateAccumulator / 1e27
        uint256 debtUSD = (vault.scaledDebt * assetState.rateAccumulator) / RAY;
        if (debtUSD == 0) return type(uint256).max; // Undefined/∞ if debtUSD == 0
        
        // Per outline: collateralValueUSD = collateral * price / unitScale
        uint256 collateralValueUSD = _getCollateralValueUSD(user, asset);
        
        // Per outline: CR = collateralValueUSD / debtUSD
        return (collateralValueUSD * 1e18) / debtUSD;
    }

    /**
     * @notice Get collateral value in USD for a user
     * @param user The user address  
     * @param asset The collateral asset
     * @return The collateral value in USD (1e18 scale)
     */
    function _getCollateralValueUSD(address user, address asset) internal view returns (uint256) {
        Vault memory vault = vaults[user][asset];
        CollateralConfig memory assetConfig = collateralConfigs[asset];
        
        uint256 price = priceOracle.getAssetPrice(asset); // USD 1e18
        require(price > 0, "CDPEngine: invalid price");
        
        return (vault.collateral * price) / assetConfig.unitScale;
    }

    /**
     * @notice Efficient integer exponentiation (from Maker's math library)
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
        require(liquidationRatio > 1e18, "CDPEngine: liquidation ratio too low");
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
