import "/dapp/dapp/contracts/Dapp.sol";

contract Vintage_5 {
    address public owner;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    address[] public inventoryIds;
    uint public vintage;
    uint public bufferAmount;
    uint public estimatedReductionAmount;
    uint public actualReductionAmount;
    string public verifier;

    constructor(
        uint _vintage,
        uint _bufferAmount,
        uint _estimatedReductionAmount,
        uint _actualReductionAmount,
        string _verifier
    ) {
        owner = tx.origin;

        inventoryIds = [];
        vintage = _vintage;
        bufferAmount = _bufferAmount;
        estimatedReductionAmount = _estimatedReductionAmount;
        actualReductionAmount = _actualReductionAmount;
        verifier = _verifier;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }

    function addInventoryId(address _inventoryId) public returns (uint256) {
        inventoryIds.push(_inventoryId);
        return (RestStatus.OK);
    }
}
