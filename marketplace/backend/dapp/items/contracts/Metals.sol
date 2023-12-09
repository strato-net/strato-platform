import "/dapp/orders/contracts/Sales/MetalsSale.sol";

pragma es6;
pragma strict;
import <3efeac2e0e1801d90653e56ebdce867bbec5874a>;

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
        serialNumber = _serialNumber;
        source = _source;

        createSales(_paymentTypes, _price);
    }

    function createSales(PaymentType[] _paymentTypes, uint _price) public requireOwner("create sales") returns (uint) {
        for (uint i = 0; i < _paymentTypes.length; i++) {
            whitelistSale(address(new MetalsSale(address(this), _paymentTypes[i], _price)));
        }
        status = ItemStatus.PUBLISHED;
        return RestStatus.OK;
    }

    function update(
        ItemStatus _status,
        uint _price
    ) public requireOwner("update metals") returns (uint) {
        updateAsset(name, description, images, _status, _price);
        return RestStatus.OK;
    }
}