// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "./CDPVault.sol";

contract CDPEngine {
    // External contracts

    CDPVault public immutable cdpVault;

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

    // State variables
    mapping(address => CollateralConfig) public collateralConfigs;
    mapping(address => CollateralGlobalState) public collateralGlobalStates;
    mapping(address => mapping(address => Vault)) public vaults; // user => asset => vault

    bool public globalPaused;
    address[] public supportedAssets;
    mapping(address => bool) public isSupportedAsset;

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
}
