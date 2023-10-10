import "/dapp/dapp/contracts/Dapp.sol";

/// @title Transfer
contract Transfer {
    address public inventoryId;
    uint public transferDate;
    int public quantity;
    address public newOwner;
    string public newOwnerOrganization;
    string public newOwnerOrganizationalUnit;
    address public owner;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;

    constructor(
        address _inventoryId,
        uint _transferDate,
        int _quantity,
        address _newOwner,
        address _owner
    ) public {
        inventoryId = _inventoryId;
        transferDate = _transferDate;
        quantity = _quantity;

        newOwner = _newOwner;
        mapping(string => string) newOwnerCert = getUserCert(newOwner);
        newOwnerOrganization = newOwnerCert["organization"];
        newOwnerOrganizationalUnit = newOwnerCert["organizationalUnit"];

        owner = _owner;
        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
    }
}
   
