//ERC20
import "../abstract/ERC20/ERC20.sol";
//import "ERC20/extensions/ERC20Burnable.sol";

//Generic token
import "./Tokens/Token.sol";
import "./Tokens/TokenFactory.sol";
import "./Tokens/TokenFaucet.sol";
//import "Tokens/Metadata/TokenMetadata.sol";
//import "Tokens/TokenAccess.sol";

//Swap
import "./Pools/Pool.sol";
import "./Pools/PoolFactory.sol";

//OnRamp
import "./OnRamp/OnRamp.sol";

//Redemption
//import "Redemptions/RedemptionService.sol";
//import "Redemptions/CryptoRedemptionService.sol"; incomplete
//import "Redemptions/PhysicalRedemptionService.sol"; doesn't compile

//Lending
import "./Lending/CollateralVault.sol";
import "./Lending/LendingPool.sol";
import "./Lending/LendingRegistry.sol";
import "./Lending/LiquidityPool.sol";
import "./Lending/PoolConfigurator.sol";
import "./Lending/PriceOracle.sol";
import "./Lending/RateStrategy.sol";

//Bridging
import "./Bridge/MercataEthBridge.sol";

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
    TokenFactory public tokenFactory;

    constructor() public {
        tokenFactory = TokenFactory(0x000000000000000000000000000000000000100b);

        lendingRegistry = new LendingRegistry(this);
        collateralVault = new CollateralVault(address(lendingRegistry), msg.sender);
        liquidityPool = new LiquidityPool(address(lendingRegistry), msg.sender);
        rateStrategy = new RateStrategy();
        priceOracle = new PriceOracle(msg.sender); 
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
        mercataEthBridge = new MercataEthBridge(msg.sender,address(tokenFactory));
        onRamp = new OnRamp(address(priceOracle), msg.sender, address(tokenFactory), address(0xa96c02a13b558fbcf923af1d586967cf7f55c753));
    }
}