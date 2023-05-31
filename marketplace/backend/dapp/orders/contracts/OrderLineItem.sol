 

import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";


/// @title A representation of OrderLineItem assets
contract OrderLineItem {

    address public owner;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    address public orderLineId;
    string public itemId;
    string public itemSerialNumber;
    uint public createdDate;

    /// @dev Events to add and remove members to this shard.
    event OrgAdded(string orgName);
    event OrgUnitAdded(string orgName, string orgUnit);
    event CommonNameAdded(string orgName, string orgUnit, string commonName); 

    event OrgRemoved(string orgName);
    event OrgUnitRemoved(string orgName, string orgUnit);
    event CommonNameRemoved(string orgName, string orgUnit, string commonName);


    constructor(
            address _orderLineId
        ,   string _itemId
        ,   string _itemSerialNumber
        ,   uint _createdDate
    ) public {
        owner = tx.origin;

        orderLineId = _orderLineId;
        itemId = _itemId;
        itemSerialNumber = _itemSerialNumber == "" ? _itemId : _itemSerialNumber;
        createdDate = _createdDate;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }

    //TODO remove it in future iterations
    
    // function update(
    //     address _orderLineId
    // ,   string _itemId
    // ,   string _itemSerialNumber
    // ,uint _scheme
    // ) returns (uint) {
    //   if (tx.origin != owner) { return RestStatus.FORBIDDEN; }

    //   if (_scheme == 0) {
    //     return RestStatus.OK;
    //   }

    //   if ((_scheme & (1 << 0)) == (1 << 0)) {
    //     orderLineId = _orderLineId;
    //   }
    //   if ((_scheme & (1 << 1)) == (1 << 1)) {
    //     itemId = _itemId;
    //   }
    //   if ((_scheme & (1 << 2)) == (1 << 2)) {
    //     productId = _productId;
    //   }
    //   if ((_scheme & (1 << 3)) == (1 << 3)) {
    //     itemSerialNumber = _itemSerialNumber;
    //   }

    //   return RestStatus.OK;
    // }

   
}
