pragma solidvm 12.0;

import <509>;
import "Templates/Assets/Asset.sol";
import "Templates/Assets/Mintable.sol";
import "Templates/Assets/SemiFungible.sol";
import "Templates/Assets/UTXO.sol";
import "Templates/Enums/RestStatus.sol";
import "Templates/Payments/PaymentService.sol";
import "Templates/Payments/StratPaymentService.sol";
import "Templates/Redemptions/RedemptionService.sol";
import "Templates/Sales/Sale.sol";
import "Templates/Sales/SimpleSale.sol";
import "Templates/Utils/Utils.sol";
import "../items/contracts/Art.sol";
import "../items/contracts/CarbonDAO.sol";
import "../items/contracts/Clothing.sol";
import "../items/contracts/Collectibles.sol";
import "../items/contracts/Membership.sol";
import "../items/contracts/Metals.sol";
import "../items/contracts/Spirits.sol";
import "../items/contracts/STRATS.sol";
import "../items/contracts/Tokens.sol";
// Uncomment to test whether all non-base contracts typecheck
// import "All.sol";

contract Mercata{}