import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";
import "/dapp/items/contracts/ItemStatus.sol";
import "/dapp/items/rawMaterials/contracts/RawMaterial.sol";

/// @title A representation of Item assets
contract Item is ItemStatus, Asset {
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    address public inventoryId;
    string public serialNumber;
    ItemStatus public status;
    string public comment; // to store remarks if the item is removed from the application.
    uint public itemNumber;
    uint public createdDate;

    event OwnershipUpdate(
        string seller,
        string newOwner,
        uint ownershipStartDate,
        address itemAddress
    );

    constructor(
        uint _uniqueProductCode,
        address _inventoryId,
        string _serialNumber,
        ItemStatus _status,
        string _comment,
        uint _itemNumber,
        uint _createdDate,
        address _owner,
        string _name,
        string _desc
    ) public Asset(string _name, string _desc ){
        owner = _owner;

        productId = _productId;
        inventoryId = _inventoryId;
        serialNumber = _serialNumber;
        status = _status;
        comment = _comment;
        createdDate = _createdDate;
        itemNumber = _itemNumber;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];

    }

    function update(
        ItemStatus _status,
        string _comment,
        uint _scheme
    ) returns (uint) {
        if (ownerOrganization != getUserOrganization(tx.origin)) {
            return RestStatus.FORBIDDEN;
        }

        if (_scheme == 0) {
            return RestStatus.OK;
        }

        if ((_scheme & (1 << 0)) == (1 << 0)) {
            status = _status;
        }
        if ((_scheme & (1 << 1)) == (1 << 1)) {
            comment = _comment;
        }

        return RestStatus.OK;
    }

    // Get the userOrganization
    function getUserOrganization(address caller) public returns (string) {
        mapping(string => string) ownerCert = getUserCert(caller);
        string userOrganization = ownerCert["organization"];
        return userOrganization;
    }

    function generateOwnershipHistory(
        string _seller,
        string _newOwner,
        uint _ownershipStartDate,
        address _itemAddress
    ) returns (uint) {
        if (ownerOrganization != getUserOrganization(tx.origin)) {
            return RestStatus.FORBIDDEN;
        }
        emit OwnershipUpdate(
            _seller,
            _newOwner,
            _ownershipStartDate,
            _itemAddress
        );
        return RestStatus.OK;
    }

    // Transfer the ownership of a Item
    // function transferOwnership(
    //     address _addr,
    //     address _productId,
    //     address _inventoryId
    // ) public returns (uint256) {
    //     // caller must be current owner to transfer ownership
    //     if (ownerOrganization != getUserOrganization(tx.origin)) {
    //         return RestStatus.FORBIDDEN;
    //     }

    //     // fetch new owner cert details (org and unit)
    //     mapping(string => string) newOwnerCert = getUserCert(_addr);
    //     string newOwnerCommonName = newOwnerCert["commonName"];

    //     // add new owner org (and maybe unit)
    //     if (newOwnerOrganization == "") return RestStatus.NOT_FOUND;

    //     generateOwnershipHistory(
    //         ownerOrganization,
    //         newOwnerOrganization,
    //         block.timestamp,
    //         address(this)
    //     );
    //     // set newOwner as asset owner
    //     owner = _addr;
    //     ownerOrganization = newOwnerOrganization;
    //     ownerOrganizationalUnit = newOwnerOrganizationalUnit;
    //     ownerCommonName = newOwnerCommonName;
    //     productId = _productId;
    //     inventoryId = _inventoryId;
    //     return RestStatus.OK;
    // }
}
