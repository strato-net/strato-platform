
//TODO
contract Mercata {
    RateStrategy public rateStrategy;
    PriceOracle public priceOracle;
    CollateralVault public collateralVault;
    LiquidityPool public liquidityPool;
    LendingPool public lendingPool;
    PoolConfigurator public poolConfigurator;
    LendingRegistry public lendingRegistry;
    MercataEthBridge public mercataEthBridge;
    OnRamp public onRamp;
    PoolFactory public poolFactory;

    constructor() public {
        rateStrategy = RateStrategy(new RateStrategy());
        priceOracle = PriceOracle(new PriceOracle());
        collateralVault = CollateralVault(new CollateralVault());
        liquidityPool = LiquidityPool(new LiquidityPool());
        lendingPool = LendingPool(new LendingPool(address(liquidityPool), address(collateralVault), address(rateStrategy), address(priceOracle)));
        poolConfigurator = PoolConfigurator(new PoolConfigurator(address(lendingPool)));
        lendingRegistry = LendingRegistry(new LendingRegistry(address(lendingPool), address(liquidityPool), address(collateralVault), address(rateStrategy)));
        collateralVault.setLendingPool(address(lendingPool));
        liquidityPool.setLendingPool(address(lendingPool));
        mercataEthBridge = MercataEthBridge(new MercataEthBridge(address(msg.sender)));
        onRamp = OnRamp(new OnRamp(address(priceOracle), msg.sender));
        poolFactory = PoolFactory(new PoolFactory());
    }
}