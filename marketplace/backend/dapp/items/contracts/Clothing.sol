import "/dapp/orders/contracts/Sales/ClothingSale.sol";

pragma es6;
pragma strict;
import <d816194227e1a7a780fff236a449604afeb36255>;

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

    function updateClothing(
        string _name, 
        string _description, 
        string[] _images, 
        ItemStatus _status,
        string _serialNumber,
        string _brand,
        uint _price
    ) public requireOwner("update asset") returns (uint) {
        name = _name;
        description = _description;
        images = _images;
        serialNumber = _serialNumber;
        brand = _brand;
        if (_status == ItemStatus.UNPUBLISHED) {
            disableAllSales();
            status = _status;
            return RestStatus.OK;
        }
        uint price = Sale(whitelistedSales[0]).price()
        if (_price != price) {
            changePrice(_price);
        }
        return RestStatus.OK;
    }
}