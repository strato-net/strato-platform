import "/dapp/dapp/contracts/Dapp.sol";

contract RetiredItem_2 {
    address public owner;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    address public inventoryId;
    string public retiredBy;
    string public retiredOnBehalfOf;
    int public quantity;
    string public purpose;
    uint public retirementDate;
    string public batchSerializationNumber;

    constructor(
        address _inventoryId,
        string _retiredBy,
        string _retiredOnBehalfOf,
        int _quantity,
        string _purpose,
        uint _retirementDate,
        string _batchSerializationNumber
    ) {
        owner = tx.origin;

        inventoryId = _inventoryId;
        retiredBy = _retiredBy;
        retiredOnBehalfOf = _retiredOnBehalfOf;
        quantity = _quantity;
        purpose = _purpose;
        retirementDate = _retirementDate;
        batchSerializationNumber = _batchSerializationNumber;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }
}
