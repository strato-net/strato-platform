import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";

/** @dev Importing contracts to be later instantiated on chains via codePtr */
import "/dapp/products/contracts/ProductManager.sol";
import "/dapp/orders/contracts/Order.sol";
import "/dapp/eventType/contracts/EventType.sol";
import "/dapp/eventType/contracts/EventTypeManager.sol";
import "/dapp/orders/contracts/OrderLine.sol";
import "/dapp/orders/contracts/OrderLineItem.sol";
import "/dapp/items/contracts/Event.sol";
import "/dapp/items/contracts/ItemManager.sol";
import "/dapp/payments/contracts/PaymentManager.sol";
import "/dapp/orders/contracts/OrderManager.sol";
/**
 * Single entry point to all the project's contracts
 * Deployed by the deploy script
 *
 */

contract Dapp {

    // ---- here are some other managers we have, you can import and use them if you want
    // OrganizationManager organizationManager;
    // MembershipManager membershipManager;
    // UserManager userManager;
    // ItemManager itemManager;
    // ProductManager public productManager;
    EventTypeManager_10 eventTypeManager;
    PaymentManager paymentManager;
    OrderManager orderManager;
    
    account public bootUserAccount;
    string public bootUserCommonName;
    string public bootUserOrganization;
    string public bootUserOrganizationalUnit;

    constructor() public {
        bootUserAccount = account(tx.origin, "main");
        mapping (string => string) userCert = getUserCert(bootUserAccount);

        // TODO initialize manager contract here to check permissions
        bootUserCommonName = userCert["commonName"];
        bootUserOrganization = userCert["organization"];
        bootUserOrganizationalUnit = userCert["organizationalUnit"];
        orderManager = new OrderManager();
        // itemManager = new ItemManager();
        // productManager = new ProductManager();
        eventTypeManager = new EventTypeManager_10();
        paymentManager = new PaymentManager();
    }

    

    // function getProductManager() public returns (ProductManager) {
    //     return productManager;
    // }
}
