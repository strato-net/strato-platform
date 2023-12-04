import "/dapp/orders/contracts/Sales/MaterialsSale.sol";

pragma es6;
pragma strict;
import <0b469dbb1f0207a49cb014192ab05a72f5b2fcf3>;

/// @title A representation of Metals assets
contract Metals is ItemStatus, RestStatus, Asset {
    string public serialNumber;
    string public source;

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
        string _source,
        PaymentType[] _paymentTypes
    ) public Asset(_name, _description, _images, _createdDate ){
        owner = _owner;

        serialNumber = _serialNumber;
        source = _source;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerCommonName = ownerCert["commonName"];

        createSales(_paymentTypes, _price);
    }

    function createSales(PaymentType[] _paymentTypes, uint _price) public requireOwner("create sales") returns (uint) {
        for (uint i = 0; i < _paymentTypes.length; i++) {
            whitelistSale(address(new MaterialsSale(address(this), _paymentTypes[i], _price)));
        }
        status = ItemStatus.PUBLISHED;
        return RestStatus.OK;
    }

    function update(
        string _name, 
        string _description, 
        string[] _images, 
        ItemStatus _status,
        string _serialNumber,
        string _source,
        uint _price
    ) public requireOwner("update metals") returns (uint) {
        serialNumber = _serialNumber;
        source = _source;
        updateAsset(_name, _description, _images, _status, _price);
        return RestStatus.OK;
    }
}