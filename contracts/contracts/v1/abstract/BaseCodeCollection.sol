//ERC20
import "ERC20/ERC20.sol";
//import "ERC20/extensions/ERC20Burnable.sol";

//Generic token
import "Tokens/Token.sol";
import "Tokens/TokenFaucet.sol";
//import "Tokens/Metadata/TokenMetadata.sol";
//import "Tokens/TokenAccess.sol";

//Swap
import "Pools/Pool.sol";
import "Pools/PoolFactory.sol";

//OnRamp
import "../concrete/OnRamp/OnRamp.sol";

//Redemption
//import "Redemptions/RedemptionService.sol";
//import "Redemptions/CryptoRedemptionService.sol"; incomplete
//import "Redemptions/PhysicalRedemptionService.sol"; doesn't compile

//Lending
import "../concrete/Lending/CollateralVault.sol";
import "../concrete/Lending/LendingPool.sol";
import "../concrete/Lending/LendingRegistry.sol";
import "../concrete/Lending/LiquidityPool.sol";
import "../concrete/Lending/PoolConfigurator.sol";
import "../concrete/Lending/PriceOracle.sol";
import "../concrete/Lending/RateStrategy.sol";

//Bridging
import "Bridge/MercataEthBridge.sol";

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