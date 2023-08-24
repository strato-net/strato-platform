import "/dapp/dapp/contracts/Dapp.sol";

contract Vintage {
    address public owner;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    address public inventoryId;
    uint public vintage;
    uint public retiredQuantity;
    uint public bufferAmount;
    uint public estimatedReductionAmount;
    uint public actualReductionAmount;
    string public verifier;

    constructor(
        address _inventoryId,
        uint _vintage,
        uint _retiredQuantity,
        uint _bufferAmount,
        uint _estimatedReductionAmount,
        uint _actualReductionAmount,
        string _verifier
    ) {
        owner = tx.origin;

        inventoryId = _inventoryId;
        vintage = _vintage;
        retiredQuantity = _retiredQuantity;
        bufferAmount = _bufferAmount;
        estimatedReductionAmount = _estimatedReductionAmount;
        actualReductionAmount = _actualReductionAmount;
        verifier = _verifier;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }
}
