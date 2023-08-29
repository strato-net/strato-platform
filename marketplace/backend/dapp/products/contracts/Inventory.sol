import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";
import "/dapp/products/contracts/InventoryStatus.sol";
import "./RetiredItem.sol";
import "./Vintage.sol";

/// @title A representation of Inventory assets
contract Inventory_11 is InventoryStatus {
    address public owner;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    address public productId;
    address public vintageId;
    string public category;
    uint public purchasedQuantity;
    uint public retiredQuantity;
    int public pricePerUnit;
    uint public vintage;
    uint public availableQuantity;
    InventoryStatus public status;
    uint public createdDate;
    string public batchSerializationNumber;

    constructor(
        address _vintageId,
        string _category,
        uint _quantity,
        int _pricePerUnit,
        uint _vintage,
        InventoryStatus _status,
        uint _createdDate,
        string _batchSerializationNumber,
        address _owner
    ) public {
        owner = _owner;

        productId = msg.sender;
        vintageId = _vintageId;
        category = _category;
        purchasedQuantity = 0;
        retiredQuantity = 0;
        pricePerUnit = _pricePerUnit;
        vintage = _vintage;
        availableQuantity = _quantity;
        status = _status;
        createdDate = _createdDate;
        batchSerializationNumber = _batchSerializationNumber;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }

    function update(
        int _pricePerUnit,
        InventoryStatus _status,
        uint _scheme
    ) returns (uint) {
        if (ownerOrganization != getUserOrganization(tx.origin)) {
            return RestStatus.FORBIDDEN;
        }

        if (_scheme == 0) {
            return RestStatus.OK;
        }

        if ((_scheme & (1 << 0)) == (1 << 0)) {
            pricePerUnit = _pricePerUnit;
        }
        if ((_scheme & (1 << 1)) == (1 << 1)) {
            status = _status;
        }

        return RestStatus.OK;
    }

    function updateQuantity(uint _quantity) returns (uint) {
        availableQuantity = _quantity;
        return RestStatus.OK;
    }

    function updateQuantityForResell(uint _quantity) returns (uint256) {
        availableQuantity = availableQuantity - _quantity;
        return RestStatus.OK;
    }

    function retireCredits(
        address _inventoryId,
        string _retiredBy,
        string _retiredOnBehalfOf,
        uint _quantity,
        string _purpose
    ) public returns (uint256, address) {
        RetiredItem_3 retiredItem = new RetiredItem_3(
            _inventoryId,
            _retiredBy,
            _retiredOnBehalfOf,
            _quantity,
            _purpose,
            block.timestamp,
            batchSerializationNumber
        );

        availableQuantity = availableQuantity - _quantity;
        retiredQuantity = retiredQuantity + _quantity;

        return (RestStatus.OK, address(retiredItem));
    }

    // Get the userOrganization
    function getUserOrganization(address caller) public returns (string) {
        mapping(string => string) ownerCert = getUserCert(caller);
        string userOrganization = ownerCert["organization"];
        return userOrganization;
    }
}
