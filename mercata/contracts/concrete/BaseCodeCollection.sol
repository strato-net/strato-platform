//ERC20
import "../abstract/ERC20/ERC20.sol";
//import "ERC20/extensions/ERC20Burnable.sol";

//Generic token
import "./Tokens/Token.sol";
import "./Tokens/TokenFactory.sol";
import "./Tokens/TokenFaucet.sol";
//import "Tokens/Metadata/TokenMetadata.sol";
//import "Tokens/TokenAccess.sol";

//Admin Registry
import "Admin/AdminRegistry.sol";

//Swap
import "./Pools/Pool.sol";
import "./Pools/PoolFactory.sol";

//Admin
// import "Admin/FeeCollector.sol";

//Redemption
//import "Redemptions/RedemptionService.sol";
//import "Redemptions/CryptoRedemptionService.sol"; incomplete
//import "Redemptions/PhysicalRedemptionService.sol"; doesn't compile

//Rewards
import "./Rewards/RewardsManager.sol";

//Lending
import "Lending/CollateralVault.sol";
import "Lending/LendingPool.sol";
import "Lending/LendingRegistry.sol";
import "Lending/LiquidityPool.sol";
import "Lending/PoolConfigurator.sol";
import "Lending/PriceOracle.sol";
import "Lending/RateStrategy.sol";
import "Lending/SafetyModule.sol";

//Bridging
import "./Bridge/MercataBridge.sol";

//CDP
import "CDP/CDPRegistry.sol";
import "CDP/CDPEngine.sol";
import "CDP/CDPVault.sol";
import "CDP/CDPReserve.sol";

//Proxy
import "Proxy/Proxy.sol";

//TODO
contract record Mercata {
    RateStrategy public rateStrategy;
    PriceOracle public priceOracle;
    CollateralVault public collateralVault;
    LiquidityPool public liquidityPool;
    LendingPool public lendingPool;
    PoolConfigurator public poolConfigurator;
    LendingRegistry public lendingRegistry;
    MercataBridge public mercataBridge;
    PoolFactory public poolFactory;
    TokenFactory public tokenFactory;
    FeeCollector public feeCollector;
    AdminRegistry public adminRegistry;
    RewardsManager public rewardsManager;
    CDPEngine public cdpEngine;
    CDPVault public cdpVault;   
    CDPRegistry public cdpRegistry;
    CDPReserve public cdpReserve;
    SafetyModule public safetyModule;

    constructor() public {
        // Create AdminRegistry first
        address adminRegistryImpl = address(new AdminRegistry());
        adminRegistry = AdminRegistry(address(new Proxy(adminRegistryImpl, this)));
        adminRegistry.initialize([this]);
        Ownable(address(adminRegistry)).transferOwnership(address(adminRegistry));

        // Create FeeCollector
        address feeCollectorImpl = address(new FeeCollector(this));
        feeCollector = FeeCollector(address(new Proxy(feeCollectorImpl, this)));
        Ownable(feeCollector).transferOwnership(address(adminRegistry));

        // Create Factories
        address tokenFactoryImpl = address(new TokenFactory(this));
        tokenFactory = TokenFactory(address(new Proxy(tokenFactoryImpl, this)));
        Ownable(tokenFactory).transferOwnership(address(adminRegistry));

        address poolFactoryImpl = address(new PoolFactory(this));
        poolFactory = PoolFactory(address(new Proxy(poolFactoryImpl, this)));
        poolFactory.initialize(address(tokenFactory), address(adminRegistry), address(feeCollector));
        Ownable(poolFactory).transferOwnership(address(adminRegistry));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(tokenFactory), "createTokenWithInitialOwner", address(poolFactory));

        // Create Lending related contracts
        address lendingRegistryImpl = address(new LendingRegistry(this));
        lendingRegistry = LendingRegistry(address(new Proxy(lendingRegistryImpl, this)));
        Ownable(lendingRegistry).transferOwnership(address(adminRegistry));

        address collateralVaultImpl = address(new CollateralVault(this));
        collateralVault = CollateralVault(address(new Proxy(collateralVaultImpl, this)));
        collateralVault.initialize(address(lendingRegistry));
        Ownable(collateralVault).transferOwnership(address(adminRegistry));

        address liquidityPoolImpl = address(new LiquidityPool(this));
        liquidityPool = LiquidityPool(address(new Proxy(liquidityPoolImpl, this)));
        liquidityPool.initialize(address(lendingRegistry));
        Ownable(liquidityPool).transferOwnership(address(adminRegistry));

        address rateStrategyImpl = address(new RateStrategy());
        rateStrategy = RateStrategy(address(new Proxy(rateStrategyImpl, this)));
        Ownable(address(rateStrategy)).transferOwnership(address(adminRegistry));

        address priceOracleImpl = address(new PriceOracle(this));
        priceOracle = PriceOracle(address(new Proxy(priceOracleImpl, this)));
        Ownable(priceOracle).transferOwnership(address(adminRegistry));

        address poolConfiguratorImpl = address(new PoolConfigurator(this));
        poolConfigurator = PoolConfigurator(address(new Proxy(poolConfiguratorImpl, this)));
        poolConfigurator.initialize(address(lendingRegistry));

        address safetyModuleImpl = address(new SafetyModule(this));
        safetyModule = SafetyModule(address(new Proxy(safetyModuleImpl, this)));
        safetyModule.initialize(address(lendingRegistry), address(tokenFactory));
        Ownable(safetyModule).transferOwnership(address(adminRegistry));

        address lendingPoolImpl = address(new LendingPool(this));
        lendingPool = LendingPool(address(new Proxy(lendingPoolImpl, this)));
        lendingPool.initialize(address(lendingRegistry), address(poolConfigurator), address(tokenFactory), address(feeCollector), address(safetyModule));
        Ownable(lendingPool).transferOwnership(address(adminRegistry));
          
        Ownable(lendingRegistry).transferOwnership(address(poolConfigurator)); 
        poolConfigurator.initializeProtocol(address(lendingPool),address(liquidityPool),address(collateralVault),address(rateStrategy),address(priceOracle),address(tokenFactory),[],[],[],[],[],[],[],0,0,1000);
        Ownable(poolConfigurator).transferOwnership(address(adminRegistry));

        // Create Services
        address mercataBridgeImpl = address(new MercataBridge(this));
        mercataBridge = MercataBridge(address(new Proxy(mercataBridgeImpl, this)));
        mercataBridge.initialize(address(tokenFactory), address(adminRegistry));
        Ownable(mercataBridge).transferOwnership(address(adminRegistry));

        address rewardsManagerImpl = address(new RewardsManager(this));
        rewardsManager = RewardsManager(address(new Proxy(rewardsManagerImpl, this)));
        rewardsManager.initialize(RewardsManagerArgs([], [], [], [], address(0)));
        Ownable(rewardsManager).transferOwnership(address(adminRegistry));

        // Deploy CDP registry, vault, and engine
        address cdpRegistryImpl = address(new CDPRegistry(this));
        cdpRegistry = CDPRegistry(address(new Proxy(cdpRegistryImpl, this)));

        address cdpVaultImpl = address(new CDPVault(this));
        cdpVault = CDPVault(address(new Proxy(cdpVaultImpl, this)));
        cdpVault.initialize(address(cdpRegistry));
        Ownable(cdpVault).transferOwnership(address(adminRegistry));

        address cdpEngineImpl = address(new CDPEngine(this));
        cdpEngine = CDPEngine(address(new Proxy(cdpEngineImpl, this)));
        cdpEngine.initialize(address(cdpRegistry));
        Ownable(cdpEngine).transferOwnership(address(adminRegistry));

        address cdpReserveImpl = address(new CDPReserve(this));
        cdpReserve = CDPReserve(address(new Proxy(cdpReserveImpl, this)));
        cdpReserve.initialize(address(cdpRegistry));
        Ownable(cdpReserve).transferOwnership(address(adminRegistry));

        cdpRegistry.setAllComponents(address(cdpVault), address(cdpEngine), address(priceOracle), address(0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010), address(tokenFactory), address(feeCollector), address(cdpReserve));
        Ownable(cdpRegistry).transferOwnership(address(adminRegistry));

        adminRegistry.castVoteOnIssue(address(adminRegistry), "swapAdmin", msg.sender);
    }
}