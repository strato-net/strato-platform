import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";

/** @dev Importing contracts to be later instantiated on chains via codePtr */
import "/dapp/products/contracts/ProductManager.sol";
import "/dapp/orders/contracts/Order.sol";
import "/dapp/eventType/contracts/EventType.sol";
import "/dapp/eventType/contracts/EventTypeManager.sol";
import "/dapp/service/contracts/Service.sol";
import "/dapp/service/contracts/ServiceManager.sol";
import "/dapp/orders/contracts/OrderLine.sol";
import "/dapp/orders/contracts/OrderLineItem.sol";
import "/dapp/items/contracts/Event.sol";
import "/dapp/items/contracts/ItemManager.sol";
import "/dapp/payments/contracts/PaymentManager.sol";
import "/dapp/orders/contracts/OrderManager.sol";
import "/dapp/membership/contracts/MembershipManager.sol";
/**
 * Single entry point to all the project's contracts
 * Deployed by the deploy script
 *
 */

contract Dapp {
    event OrgAdded(string orgName);
    event OrgUnitAdded(string orgName, string orgUnit);
    event CommonNameAdded(string orgName, string orgUnit, string commonName);

    event OrgRemoved(string orgName);
    event OrgUnitRemoved(string orgName, string orgUnit);
    event CommonNameRemoved(string orgName, string orgUnit, string commonName);

    // ---- here are some other managers we have, you can import and use them if you want
    // OrganizationManager organizationManager;
    // UserManager userManager;
    Mem_ItemManager itemManager;
    Mem_ProductManager public productManager;
    EventTypeManager_10 eventTypeManager;
    Mem_ServiceManager_10 serviceManager;
    Mem_PaymentManager paymentManager;
    Mem_OrderManager orderManager;
    Mem_MembershipManager membershipManager;
    
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
        orderManager = new Mem_OrderManager();
        itemManager = new Mem_ItemManager();
        productManager = new Mem_ProductManager();
        eventTypeManager = new EventTypeManager_10();
        serviceManager = new Mem_ServiceManager_10();
        paymentManager = new Mem_PaymentManager();
        membershipManager = new Mem_MembershipManager();
    }

    function getProductManager() public returns (Mem_ProductManager) {
        return productManager;
    }

    function getMembershipManager() public returns (Mem_MembershipManager) {
        return membershipManager;
    }

    function addOrg(string _orgName) {
        assert(msg.sender == address(bootUserAccount));
        emit OrgAdded(_orgName);
    }

    function addOrgUnit(string _orgName, string _orgUnit) {
        assert(msg.sender == address(bootUserAccount));
        emit OrgUnitAdded(_orgName, _orgUnit);
    }

    function addMember(string _orgName, string _orgUnit, string _commonName) {
        assert(msg.sender == address(bootUserAccount));
        emit CommonNameAdded(_orgName, _orgUnit, _commonName);
    }

    function removeOrg(string _orgName) {
        assert(msg.sender == address(bootUserAccount));
        emit OrgRemoved(_orgName);
    }

    function removeOrgUnit(string _orgName, string _orgUnit) {
        assert(msg.sender == address(bootUserAccount));
        emit OrgUnitRemoved(_orgName, _orgUnit);
    }

    function removeMember(
        string _orgName,
        string _orgUnit,
        string _commonName
    ) {
        assert(msg.sender == address(bootUserAccount));
        emit CommonNameRemoved(_orgName, _orgUnit, _commonName);
    }

    function addOrgs(string[] _orgNames) public returns (uint256) {
        assert(msg.sender == address(bootUserAccount));
        for (uint256 i = 0; i < _orgNames.length; i++) {
            addOrg(_orgNames[i]);
        }
        return RestStatus.OK;
    }

    function addOrgUnits(
        string[] _orgNames,
        string[] _orgUnits
    ) public returns (uint256) {
        assert(msg.sender == address(bootUserAccount));
        require(
            (_orgNames.length == _orgUnits.length),
            "Input data should be consistent"
        );
        for (uint256 i = 0; i < _orgNames.length; i++) {
            addOrgUnit(_orgNames[i], _orgUnits[i]);
        }
        return RestStatus.OK;
    }

    function addMembers(
        string[] _orgNames,
        string[] _orgUnits,
        string[] _commonNames
    ) public returns (uint256) {
        assert(msg.sender == address(bootUserAccount));
        require(
            (_orgNames.length == _orgUnits.length &&
                _orgUnits.length == _commonNames.length),
            "Input data should be consistent"
        );
        for (uint256 i = 0; i < _orgNames.length; i++) {
            addMember(_orgNames[i], _orgUnits[i], _commonNames[i]);
        }
        return RestStatus.OK;
    }

    function removeOrgs(string[] _orgNames) public returns (uint256) {
        assert(msg.sender == address(bootUserAccount));
        for (uint256 i = 0; i < _orgNames.length; i++) {
            removeOrg(_orgNames[i]);
        }
        return RestStatus.OK;
    }

    function removeOrgUnits(
        string[] _orgNames,
        string[] _orgUnits
    ) public returns (uint256) {
        assert(msg.sender == address(bootUserAccount));
        require(
            (_orgNames.length == _orgUnits.length),
            "Input data should be consistent"
        );
        for (uint256 i = 0; i < _orgNames.length; i++) {
            removeOrgUnit(_orgNames[i], _orgUnits[i]);
        }
        return RestStatus.OK;
    }

    function removeMembers(
        string[] _orgNames,
        string[] _orgUnits,
        string[] _commonNames
    ) public returns (uint256) {
        assert(msg.sender == address(bootUserAccount));
        require(
            (_orgNames.length == _orgUnits.length &&
                _orgUnits.length == _commonNames.length),
            "Input data should be consistent"
        );
        for (uint256 i = 0; i < _orgNames.length; i++) {
            removeMember(_orgNames[i], _orgUnits[i], _commonNames[i]);
        }
        return RestStatus.OK;
    }
}