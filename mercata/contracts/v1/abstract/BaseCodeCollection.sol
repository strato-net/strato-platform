pragma solidvm 12.0;

import "Bridge/MercataEthBridge.sol";
import "ERC20/ERC20.sol";
import "ERC20/extensions/ERC20Burnable.sol";
import "Lending/CollateralVaultBase.sol";
import "../concrete/Lending/CollateralVault.sol";
import "Lending/LendingPoolBase.sol";
import "../concrete/Lending/LendingPool.sol";
import "Lending/LendingRegistryBase.sol";
import "../concrete/Lending/LendingRegistry.sol";
import "Lending/LiquidityPoolBase.sol";
import "../concrete/Lending/LiquidityPool.sol";
import "Lending/PoolConfiguratorBase.sol";
import "../concrete/Lending/PoolConfigurator.sol";
import "Lending/PriceOracleBase.sol";
import "../concrete/Lending/PriceOracle.sol";
import "Lending/RateStrategyBase.sol";
import "../concrete/Lending/RateStrategy.sol";
import "Pools/Pool.sol";
import "Pools/PoolFactory.sol";
import "Redemptions/RedemptionService.sol";
import "Tokens/Token.sol";
import "Tokens/TokenFaucet.sol";
import "OnRamp/OnRamp.sol";
import "../concrete/OnRamp/SimpleOnRamp.sol";

contract Mercata {
    RateStrategyBase public rateStrategy;
    PriceOracleBase public priceOracle;
    CollateralVaultBase public collateralVault;
    LiquidityPoolBase public liquidityPool;
    LendingPoolBase public lendingPool;
    PoolConfiguratorBase public poolConfigurator;
    LendingRegistryBase public lendingRegistry;
    OnRamp public onRamp;

    constructor() public {
        rateStrategy = RateStrategyBase(new RateStrategy());
        priceOracle = PriceOracleBase(new PriceOracle());
        collateralVault = CollateralVaultBase(new CollateralVault());
        liquidityPool = LiquidityPoolBase(new LiquidityPool());
        lendingPool = LendingPoolBase(new LendingPool(address(liquidityPool), address(collateralVault), address(rateStrategy), address(priceOracle)));
        poolConfigurator = PoolConfiguratorBase(new PoolConfigurator(address(lendingPool)));
        lendingRegistry = LendingRegistryBase(new LendingRegistry(address(lendingPool), address(liquidityPool), address(collateralVault), address(rateStrategy)));
        collateralVault.setLendingPool(address(lendingPool));
        liquidityPool.setLendingPool(address(lendingPool));
        onRamp = OnRamp(new SimpleOnRamp(address(priceOracle), msg.sender));
    }
}