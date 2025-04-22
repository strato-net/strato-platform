pragma solidvm 11.5;

import "Tokens/Token.sol";
import "Bridge/MercataEthBridge.sol";
import "ERC20/ERC20.sol";
import "Pools/Pool.sol";
import "Pools/PoolFactory.sol";
import "ERC20/extensions/ERC20Burnable.sol";
import "ERC20/access/Ownable.sol";
import "Redemptions/RedemptionService.sol";
import "Lending/CollateralVaultBase.sol";
import "Lending/LendingPoolBase.sol";
import "Lending/LendingRegistryBase.sol";
import "Lending/PoolConfiguratorBase.sol";
import "Lending/PriceOracleBase.sol";
import "Lending/RateStrategyBase.sol";
import "Lending/LiquidityPoolBase.sol";

contract Mercata{}