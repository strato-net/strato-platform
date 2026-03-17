//ERC20
import "../abstract/ERC20/access/Authorizable.sol";
import "../abstract/ERC20/ERC20.sol";
//import "ERC20/extensions/ERC20Burnable.sol";

//Generic token
import "./Tokens/Token.sol";
import "./Tokens/TokenFactory.sol";
//import "Tokens/Metadata/TokenMetadata.sol";

//Admin Registry
import "Admin/AdminRegistry.sol";

//Swap
import "./Pools/Pool.sol";
import "./Pools/PoolFactory.sol";
import "./Pools/StablePool.sol";

//Metals
import "./Metals/MetalForge.sol";

//Admin
// import "Admin/FeeCollector.sol";

//Rewards
import "./Rewards/Rewards.sol";

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

//Escrow
import "Escrow/Escrow.sol";

//Proxy
import "Proxy/Proxy.sol";

//Vault
import "Vault/Vault.sol";
import "Vault/VaultFactory.sol";
//TODO
contract record Mercata is Authorizable {
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
    CDPEngine public cdpEngine;
    CDPVault public cdpVault;
    CDPRegistry public cdpRegistry;
    CDPReserve public cdpReserve;
    SafetyModule public safetyModule;
    Rewards public rewards;
    Token public cataToken;
    Escrow public escrow;
    MetalForge public metalForge;

    constructor() public {
        // The owner of the implementation contract is ignored in favor of the proxy owner
        address implOwnerIgnored = address("deadbeef");

        // Create AdminRegistry first
        address adminRegistryImpl = address(new AdminRegistry());
        adminRegistry = AdminRegistry(address(new Proxy(adminRegistryImpl, this)));
        adminRegistry.initialize([this]); // Mercata contract is temporarily the sole admin
        Ownable(address(adminRegistry)).transferOwnership(address(adminRegistry));

        // Create FeeCollector
        address feeCollectorImpl = address(new FeeCollector(implOwnerIgnored));
        feeCollector = FeeCollector(address(new Proxy(feeCollectorImpl, this)));
        Ownable(feeCollector).transferOwnership(address(adminRegistry));

        // Create Factories
        address tokenFactoryImpl = address(new TokenFactory(implOwnerIgnored));
        tokenFactory = TokenFactory(address(new Proxy(tokenFactoryImpl, this)));
        Ownable(tokenFactory).transferOwnership(address(adminRegistry));

        address poolFactoryImpl = address(new PoolFactory(implOwnerIgnored));
        poolFactory = PoolFactory(address(new Proxy(poolFactoryImpl, this)));
        poolFactory.initialize(address(tokenFactory), address(adminRegistry), address(feeCollector));
        Ownable(poolFactory).transferOwnership(address(adminRegistry));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(tokenFactory), "createTokenWithInitialOwner", address(poolFactory));

        // Create Lending related contracts
        address lendingRegistryImpl = address(new LendingRegistry(implOwnerIgnored));
        lendingRegistry = LendingRegistry(address(new Proxy(lendingRegistryImpl, this)));
        Ownable(lendingRegistry).transferOwnership(address(adminRegistry));

        address collateralVaultImpl = address(new CollateralVault(implOwnerIgnored));
        collateralVault = CollateralVault(address(new Proxy(collateralVaultImpl, this)));
        collateralVault.initialize(address(lendingRegistry));
        Ownable(collateralVault).transferOwnership(address(adminRegistry));

        address liquidityPoolImpl = address(new LiquidityPool(implOwnerIgnored));
        liquidityPool = LiquidityPool(address(new Proxy(liquidityPoolImpl, this)));
        liquidityPool.initialize(address(lendingRegistry));
        Ownable(liquidityPool).transferOwnership(address(adminRegistry));

        address rateStrategyImpl = address(new RateStrategy());
        rateStrategy = RateStrategy(address(new Proxy(rateStrategyImpl, this)));
        Ownable(address(rateStrategy)).transferOwnership(address(adminRegistry));

        address priceOracleImpl = address(new PriceOracle(implOwnerIgnored));
        priceOracle = PriceOracle(address(new Proxy(priceOracleImpl, this)));
        priceOracle.initialize();
        Ownable(priceOracle).transferOwnership(address(adminRegistry));

        address poolConfiguratorImpl = address(new PoolConfigurator(implOwnerIgnored));
        poolConfigurator = PoolConfigurator(address(new Proxy(poolConfiguratorImpl, this)));
        poolConfigurator.initialize(address(lendingRegistry));
        Ownable(poolConfigurator).transferOwnership(address(adminRegistry));

        address safetyModuleImpl = address(new SafetyModule(implOwnerIgnored));
        safetyModule = SafetyModule(address(new Proxy(safetyModuleImpl, this)));
        safetyModule.initialize(address(lendingRegistry), address(tokenFactory));
        Ownable(safetyModule).transferOwnership(address(adminRegistry));

        address lendingPoolImpl = address(new LendingPool(implOwnerIgnored));
        lendingPool = LendingPool(address(new Proxy(lendingPoolImpl, this)));
        lendingPool.initialize(address(lendingRegistry), address(poolConfigurator), address(tokenFactory), address(feeCollector), address(safetyModule));
        Ownable(lendingPool).transferOwnership(address(adminRegistry));

        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(lendingRegistry), "setLendingPool", address(poolConfigurator));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(lendingRegistry), "setLiquidityPool", address(poolConfigurator));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(lendingRegistry), "setCollateralVault", address(poolConfigurator));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(lendingRegistry), "setRateStrategy", address(poolConfigurator));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(lendingRegistry), "setPriceOracle", address(poolConfigurator));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(lendingRegistry), "setAllComponents", address(poolConfigurator));
        authorizations[address(adminRegistry)][address(poolConfigurator)] = 1;
        poolConfigurator.initializeProtocol(address(lendingPool),address(liquidityPool),address(collateralVault),address(rateStrategy),address(priceOracle),address(tokenFactory),[],[],[],[],[],[],[],0,0,1000);

        // Create Services
        address mercataBridgeImpl = address(new MercataBridge(implOwnerIgnored));
        mercataBridge = MercataBridge(address(new Proxy(mercataBridgeImpl, this)));
        mercataBridge.initialize(address(tokenFactory), address(lendingRegistry));
        Ownable(mercataBridge).transferOwnership(address(adminRegistry));

        // Use existing CATA reward token
        cataToken = Token(address(0x2680dc6693021cd3fefb84351570874fbef8332a));

        // Create Rewards contract and initialize with CATA token
        address rewardsImpl = address(new Rewards(implOwnerIgnored));
        rewards = Rewards(address(new Proxy(rewardsImpl, this)));
        rewards.initialize(address(cataToken));
        Ownable(rewards).transferOwnership(address(0x000000000000000000000000000000000000100c));

        // Deploy CDP registry, vault, and engine
        address cdpRegistryImpl = address(new CDPRegistry(implOwnerIgnored));
        cdpRegistry = CDPRegistry(address(new Proxy(cdpRegistryImpl, this)));

        address cdpVaultImpl = address(new CDPVault(implOwnerIgnored));
        cdpVault = CDPVault(address(new Proxy(cdpVaultImpl, this)));
        cdpVault.initialize(address(cdpRegistry));
        Ownable(cdpVault).transferOwnership(address(adminRegistry));

        address cdpEngineImpl = address(new CDPEngine(implOwnerIgnored));
        cdpEngine = CDPEngine(address(new Proxy(cdpEngineImpl, this)));
        cdpEngine.initialize(address(cdpRegistry));
        Ownable(cdpEngine).transferOwnership(address(adminRegistry));

        address cdpReserveImpl = address(new CDPReserve(implOwnerIgnored));
        cdpReserve = CDPReserve(address(new Proxy(cdpReserveImpl, this)));
        cdpReserve.initialize(address(cdpRegistry));
        Ownable(cdpReserve).transferOwnership(address(adminRegistry));

        cdpRegistry.setAllComponents(address(cdpVault), address(cdpEngine), address(priceOracle), address(0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010), address(tokenFactory), address(feeCollector), address(cdpReserve));
        Ownable(cdpRegistry).transferOwnership(address(adminRegistry));

        address escrowImpl = address(new Escrow(implOwnerIgnored));
        escrow = Escrow(address(new Proxy(escrowImpl, this)));
        Ownable(escrow).transferOwnership(address(adminRegistry));

        address metalForgeImpl = address(new MetalForge(implOwnerIgnored));
        metalForge = MetalForge(address(new Proxy(metalForgeImpl, this)));
        metalForge.initialize(
            address(0x0000000000000000000000000000000000001002),
            address(0x141e73dc8d2dbbda4fba3797527d22be4b2c4744),
            address(0x000000000000000000000000000000000000100d),
            address(0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010)
        );
        Ownable(metalForge).transferOwnership(address(0x000000000000000000000000000000000000100c));

        adminRegistry.swapAdmin(this, msg.sender);
    }
}
