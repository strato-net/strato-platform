import "/dapp/orders/contracts/Sales/ArtSale.sol";

pragma es6;
pragma strict;
import <e206b22155d4958e9133fedb39dad88f0402df2d>;

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

    function updateArt(
        string _name, 
        string _description, 
        string[] _images, 
        ItemStatus _status,
        string _serialNumber,
        string _artist,
        uint _price
    ) public requireOwner("update art") returns (uint) {
        serialNumber = _serialNumber;
        artist = _artist;
        updateAsset(_name, _description, _images, _status, _price);
        return RestStatus.OK;
    }
}

