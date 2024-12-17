pragma solidvm 11.5;

import <509>;
import "Templates/Assets/Asset.sol";
import "Templates/Assets/Mintable.sol";
import "Templates/Assets/SemiFungible.sol";
import "Templates/Assets/UTXO.sol";
import "Templates/Enums/RestStatus.sol";
import "Templates/Escrows/Escrow.sol";
import "Templates/Escrows/SimpleEscrow.sol";
import "Templates/Payments/PaymentService.sol";
import "Templates/Oracles/OracleService.sol";
import "Templates/Redemptions/RedemptionService.sol";
import "Templates/Sales/Sale.sol";
import "Templates/Staking/Reserve.sol";
import "Templates/Utils/Utils.sol";
import "Templates/Structs/Structs.sol";
import "Templates/Bridge/MercataETHBridge.sol";
// Uncomment to test whether all non-base contracts typecheck
// import "All.sol";

contract Mercata{}