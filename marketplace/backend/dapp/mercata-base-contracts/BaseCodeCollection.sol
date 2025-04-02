pragma solidvm 11.5;

import "Templates/Assets/Asset.sol";

import "Templates/Assets/MercataMetadata.sol";

// import "Templates/Assets/LendingToken.sol";
// import "Templates/Enums/RestStatus.sol";
// import "Templates/Escrows/Escrow.sol";
// import "Templates/Escrows/SimpleEscrow.sol";
// import "Templates/Payments/PaymentService.sol";
// import "Templates/Oracles/OracleService.sol";
// import "Templates/Redemptions/RedemptionService.sol";
// import "Templates/Sales/Sale.sol";
// import "Templates/Staking/Reserve.sol";
// import "Templates/Staking/MinterAuthorization.sol";
// import "Templates/Utils/Utils.sol";
// import "Templates/Structs/Structs.sol";
import "Templates/Bridge/MercataEthBridge.sol";
import "Templates/ERC20/ERC20.sol";
import "Templates/Pools/Pool.sol";
import "Templates/Pools/PoolFactory.sol";
import "Templates/ERC20/extensions/ERC20Burnable.sol";
import "Templates/ERC20/access/Ownable.sol";
import "Templates/Redemptions/RedemptionService.sol";
// import "Templates/Redemptions/PhysicalRedemptionService.sol";
// import "Templates/Redemptions/CryptoRedemptionService.sol";

// Uncomment to test whether all non-base contracts typecheck
// import "All.sol";

contract Mercata{}