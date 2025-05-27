//ERC20
import "../abstract/ERC20/ERC20.sol";
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
import "OnRamp/OnRamp.sol";

//Redemption
//import "Redemptions/RedemptionService.sol";
//import "Redemptions/CryptoRedemptionService.sol"; incomplete
//import "Redemptions/PhysicalRedemptionService.sol"; doesn't compile

//Lending
import "Lending/CollateralVault.sol";
import "Lending/LendingPool.sol";
import "LendingRegistry.sol";
import "Lending/LiquidityPool.sol";
import "Lending/PoolConfigurator.sol";
import "Lending/PriceOracle.sol";
import "Lending/RateStrategy.sol";

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
        lendingPool = new LendingPool(msg.sender);
        poolConfigurator = new PoolConfigurator(address(lendingPool), msg.sender);
        lendingRegistry = new LendingRegistry(address(lendingPool), address(lendingPool.liquidityPool()), address(lendingPool.collateralVault()), address(lendingPool.rateStrategy()), msg.sender);
        poolFactory = PoolFactory(new PoolFactory(msg.sender));
        mercataEthBridge = MercataEthBridge(new MercataEthBridge(address(msg.sender)));
        onRamp = new OnRamp(address(lendingPool.oracle()), msg.sender);
    }
}