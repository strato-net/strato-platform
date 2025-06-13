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
    TokenFactory public tokenFactory;

    constructor() public {
        tokenFactory = new TokenFactory(msg.sender);

        lendingRegistry = new LendingRegistry(this);
        collateralVault = new CollateralVault(address(lendingRegistry), msg.sender);
        liquidityPool = new LiquidityPool(address(lendingRegistry), msg.sender);
        rateStrategy = new RateStrategy();
        priceOracle = new PriceOracle(msg.sender, address(tokenFactory)); 
        poolConfigurator = new PoolConfigurator(address(lendingRegistry), this);
        lendingPool = new LendingPool(address(lendingRegistry), address(poolConfigurator), msg.sender, address(tokenFactory));
           
        Ownable(lendingRegistry).transferOwnership(address(poolConfigurator)); 
        poolConfigurator.setLendingPool(address(lendingPool));
        poolConfigurator.setLiquidityPool(address(liquidityPool));
        poolConfigurator.setCollateralVault(address(collateralVault));
        poolConfigurator.setRateStrategy(address(rateStrategy));
        poolConfigurator.setPriceOracle(address(priceOracle)); 
        poolConfigurator.setTokenFactory(address(tokenFactory));
        Ownable(poolConfigurator).transferOwnership(msg.sender);
        
        poolFactory = new PoolFactory(msg.sender, address(tokenFactory));
        mercataEthBridge = new MercataEthBridge(msg.sender);
        onRamp = new OnRamp(address(priceOracle), msg.sender, address(tokenFactory));
    }
}