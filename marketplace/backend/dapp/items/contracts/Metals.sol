import "/dapp/orders/contracts/Sales/MetalsSale.sol";

pragma es6;
pragma strict;
import <4244a06baf12f75617016f4785897ab80e4daf3c>;

enum Unit {
    POUND,
    OUNCE,
    TON,
    KG,
    G   
}

/// @title A representation of Metals assets
contract Metals is ItemStatus, RestStatus, UTXOAsset {
    Unit public unit;
    uint public unitsPerQuantity;
    // string public serialNumber; // still needed?
    string public source;
    
    event OwnershipUpdate(
        string seller,
        string newOwner,
        uint ownershipStartDate,
        address itemAddress
    );

    constructor(
        uint _quantity,
        Unit _unit,
        uint _unitsPerQuantity,
        // string _serialNumber,
        uint _createdDate,
        address _owner,
        string _name,
        string _description,
        string[] _images,
        uint _price,
        string _source,
        PaymentType[] _paymentTypes
    ) public UTXOAsset(_name, _description, _images, _createdDate, _quantity){
        owner = _owner;

        unit = _unit;
        unitsPerQuantity = _unitsPerQuantity;
        // serialNumber = _serialNumber;
        source = _source;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerCommonName = ownerCert["commonName"];

        if(_paymentTypes.length > 0) {
            createSales(_paymentTypes, _price, _quantity);
        }
    }

    function createSales(PaymentType[] _paymentTypes, uint _price, uint _quantity) public requireOwner("create sales") returns (uint) {
        for (uint i = 0; i < _paymentTypes.length; i++) {
            whitelistSale(address(new MetalsSale(address(this), _paymentTypes[i], _price, _quantity)));
        }
        status = ItemStatus.PUBLISHED;
        return RestStatus.OK;
    }

    function updateMetals( //should you be able to update quantity?...
        Unit _unit,
        uint _unitsPerQuantity,
        string _name, 
        string _description, 
        string[] _images, 
        ItemStatus _status,
        // string _serialNumber,
        string _source,
        uint _price
    ) public requireOwner("update metals") returns (uint) {
        // serialNumber = _serialNumber;
        unit = _unit;
        unitsPerQuantity = _unitsPerQuantity;
        source = _source;
        updateAsset(_name, _description, _images, _status, _price);
        return RestStatus.OK;
    }
}