import "/dapp/orders/contracts/Sales/ArtSale.sol";

pragma es6;
pragma strict;
import <0e5223240c46b3022a73c5e589536d3781e5b93f>;

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

