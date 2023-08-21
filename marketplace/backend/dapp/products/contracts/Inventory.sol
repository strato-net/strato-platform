import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";
import "/dapp/products/contracts/InventoryStatus.sol";
import "./RetiredItem.sol";

/// @title A representation of Inventory assets
contract Inventory_7 is InventoryStatus {
    address public owner;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    address public productId;
    string public category;
    int public purchasedQuantity;
    int public quantity;
    int public pricePerUnit;
    uint public vintage;
    int public availableQuantity;
    InventoryStatus public status;
    uint public createdDate;
    string public batchSerializationNumber;
    int public retiredQuantity;

    constructor(
        string _category,
        int _quantity,
        int _pricePerUnit,
        uint _vintage,
        InventoryStatus _status,
        uint _createdDate,
        string _batchSerializationNumber,
        address _owner
    ) public {
        owner = _owner;

        productId = msg.sender;
        category = _category;
        purchasedQuantity = 0;
        quantity = _quantity;
        pricePerUnit = _pricePerUnit;
        vintage = _vintage;
        availableQuantity = _quantity;
        status = _status;
        createdDate = _createdDate;
        batchSerializationNumber = _batchSerializationNumber;
        retiredQuantity = 0;

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

    function updateQuantity(int _quantity) returns (uint) {
        availableQuantity = _quantity;
        return RestStatus.OK;
    }

    function updateQuantityForResell(int _quantity) returns (uint256) {
        availableQuantity = availableQuantity - _quantity;
        return RestStatus.OK;
    }

    function updateRetiredQuantity(int _quantity) returns (uint) {
        availableQuantity = availableQuantity - _quantity;
        retiredQuantity = retiredQuantity + _quantity;
    }

    function updateQuantityForVintages(int _quantity) returns (uint) {
        quantity = _quantity;
        availableQuantity = _quantity;
        return RestStatus.OK;
    }

    function retireCredits(
        address _inventoryId,
        string _retiredBy,
        string _retiredOnBehalfOf,
        int _quantity,
        string _purpose
    ) public returns (uint256, address) {
        RetiredItem_2 retiredItem = new RetiredItem_2(
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
