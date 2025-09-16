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
    SafetyModule public safetyModule;

    constructor() public {
        // Create AdminRegistry first
        adminRegistry = new AdminRegistry([this]);

        // Create FeeCollector
        feeCollector = new FeeCollector(address(adminRegistry));

        // Create Factories
        tokenFactory = new TokenFactory(address(adminRegistry));
        poolFactory = new PoolFactory(address(adminRegistry), address(tokenFactory), address(address(adminRegistry)), address(feeCollector));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(tokenFactory), "createTokenWithInitialOwner", address(poolFactory));

        // Create Lending related contracts
        lendingRegistry = new LendingRegistry(this);
        collateralVault = new CollateralVault(address(lendingRegistry), address(adminRegistry));
        liquidityPool = new LiquidityPool(address(lendingRegistry), address(adminRegistry));
        rateStrategy = new RateStrategy();
        priceOracle = new PriceOracle(address(adminRegistry)); 
        poolConfigurator = new PoolConfigurator(address(lendingRegistry), this);
        lendingPool = new LendingPool(address(lendingRegistry), address(poolConfigurator), address(adminRegistry), address(tokenFactory), address(feeCollector), address(safetyModule));
          
        Ownable(lendingRegistry).transferOwnership(address(poolConfigurator)); 
        poolConfigurator.initializeProtocol(address(lendingPool),address(liquidityPool),address(collateralVault),address(rateStrategy),address(priceOracle),address(tokenFactory),[],[],[],[],[],[],[],0,0,1000);
        safetyModule = new SafetyModule(address(lendingRegistry), address(tokenFactory), address(adminRegistry));
        Ownable(poolConfigurator).transferOwnership(address(adminRegistry));

        // Create Services
        mercataBridge = new MercataBridge(address(tokenFactory), address(adminRegistry), address(adminRegistry));
        rewardsManager = new RewardsManager(RewardsManagerArgs([], [], [], [], address(0)), address(adminRegistry));

        // Deploy CDP registry, vault, and engine
        cdpRegistry = new CDPRegistry(this);
        cdpVault = new CDPVault(address(cdpRegistry), address(adminRegistry));
        cdpEngine = new CDPEngine(address(cdpRegistry), address(adminRegistry));
        cdpRegistry.setAllComponents(address(cdpVault), address(cdpEngine), address(priceOracle), address(0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010), address(tokenFactory), address(feeCollector));
        Ownable(cdpRegistry).transferOwnership(address(adminRegistry));

        adminRegistry.castVoteOnIssue(address(adminRegistry), "swapAdmin", msg.sender);
    }
}