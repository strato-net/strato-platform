import "/dapp/items/contracts/ItemStatus.sol";
import "/dapp/orders/contracts/Sales/ClothingSale.sol";

pragma es6;
pragma strict;
import <d816194227e1a7a780fff236a449604afeb36255>;

/// @title A representation of Clothing assets
contract Clothing is ItemStatus, RestStatus, Asset {
    string public serialNumber;
    ItemStatus public status;
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
        status = ItemStatus.PUBLISHED;
        brand = _brand;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerCommonName = ownerCert["commonName"];

        createSales(_paymentTypes, _price);
    }

    function createSales(PaymentType[] _payment, uint _price) public requireOwner("Create sale") returns (uint) {
        for (uint i = 0; i < _paymentTypes.length; i++) {
            whitelistSale(address(new ClothingSale(address(this), _paymentTypes[i], _price)));
        }
        return RestStatus.OK;
    }
}