import "/dapp/orders/contracts/Sales/ArtSale.sol";

pragma es6;
pragma strict;
import <3efeac2e0e1801d90653e56ebdce867bbec5874a>;

/// @title A representation of Art assets
contract Art is ItemStatus, RestStatus, Asset {
    string public serialNumber;
    string public artist;

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
        string _artist,
        string[] _images,
        uint _price,
        PaymentType[] _paymentTypes
    ) public Asset(_name, _description, _images, _createdDate){
        serialNumber = _serialNumber;
        artist = _artist;
        createSales(_paymentTypes, _price);
    }

    function createSales(PaymentType[] _paymentTypes, uint _price) public requireOwner("create sales") returns (uint) {
        for (uint i = 0; i < _paymentTypes.length; i++) {
            whitelistSale(address(new ArtSale(address(this), _paymentTypes[i], _price)));
        }
        status = ItemStatus.PUBLISHED;
        return RestStatus.OK;
    }

    function update(
        ItemStatus _status,
        uint _price
    ) public requireOwner("update art") returns (uint) {
        updateAsset(name, description, images, _status, _price);
        return RestStatus.OK;
    }
}

