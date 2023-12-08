import "/dapp/orders/contracts/Sales/ClothingSale.sol";

pragma es6;
pragma strict;
import <23b42b72d97bb074316c5db4fdae6165346742f5>;

/// @title A representation of Clothing assets
contract Clothing is ItemStatus, RestStatus, Asset {
    string public serialNumber;
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
        string _brand,
        PaymentType[] _paymentTypes
    ) public Asset(_name, _description, _images, _createdDate){
        owner = _owner;

        serialNumber = _serialNumber;
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

    function update(
        ItemStatus _status,
        uint _price
    ) public requireOwner("update clothing") returns (uint) {
        updateAsset(name, description, images, _status, _price);
        return RestStatus.OK;
    }
}