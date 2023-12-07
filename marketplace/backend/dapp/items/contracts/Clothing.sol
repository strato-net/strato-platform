import "/dapp/orders/contracts/Sales/ClothingSale.sol";

pragma es6;
pragma strict;
import <0b469dbb1f0207a49cb014192ab05a72f5b2fcf3>;

/// @title A representation of Clothing assets
contract Clothing is ItemStatus, RestStatus, Asset {
    string public serialNumber;
    string public clothingType; 
    string public size; 
    string public skuNumber; 
    string public condition;
    string public brand;

    event OwnershipUpdate(
        string seller,
        string newOwner,
        uint ownershipStartDate,
        address itemAddress
    );

    constructor(
        string _serialNumber,
        uint _createdDate,
        address _owner,
        string _name,
        string _description,
        string[] _images,
        uint _price,
        string _clothingType,
        string _size,
        string _skuNumber,
        string _condition,
        string _brand,
        PaymentType[] _paymentTypes
    ) public Asset(_name, _description, _images, _createdDate){

        owner = _owner;
        serialNumber = _serialNumber;
        clothingType = _clothingType;
        size = _size;
        skuNumber = _skuNumber;
        condition = _condition;
        brand = _brand;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerCommonName = ownerCert["commonName"];

        createSales(_paymentTypes, _price);
    }

    function createSales(PaymentType[] _paymentTypes, uint _price) public requireOwner("Create sale") returns (uint) {
        for (uint i = 0; i < _paymentTypes.length; i++) {
            whitelistSale(address(new ClothingSale(address(this), _paymentTypes[i], _price)));
        }
        status = ItemStatus.PUBLISHED;
        return RestStatus.OK;
    }

    function updateClothing(
        string _name, 
        string _description, 
        string[] _images, 
        ItemStatus _status,
        string _serialNumber,
        string _clothingType,
        uint _price
    ) public requireOwner("update clothing") returns (uint) {
        serialNumber = _serialNumber;
        clothingType = _clothingType;
        updateAsset(_name, _description, _images, _status, _price);
        return RestStatus.OK;
    }
}