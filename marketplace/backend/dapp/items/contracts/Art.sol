import "/dapp/items/contracts/ItemStatus.sol";
import "/dapp/orders/contracts/Sales/ArtSale.sol";

pragma es6;
pragma strict;
import <d816194227e1a7a780fff236a449604afeb36255>;

/// @title A representation of Art assets
contract Art is ItemStatus, RestStatus, Asset {
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public serialNumber;
    ItemStatus public status;
    uint public itemNumber;
    string public artist;

    event OwnershipUpdate(
        string seller,
        string newOwner,
        uint ownershipStartDate,
        address itemAddress
    );

    constructor(
        string _serialNumber,
        ItemStatus _status,
        uint _itemNumber,
        uint _createdDate,
        address _owner,
        string _name,
        string _description,
        string _artist,
        string[] _images,
        uint _price,
        PaymentType[] _paymentTypes
    ) public Asset(_name, _description, _images, _createdDate){
        owner = _owner;

        serialNumber = _serialNumber;
        status = _status;
        itemNumber = _itemNumber;
        artist = _artist;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];

        for (uint i = 0; i < _paymentTypes.length; i++) {
            createSale(_paymentTypes[i], _price);
        }
    }

    function createSale(PaymentType _payment, uint _price) public requireOwner("Create sale") returns (uint) {// can be overridden
        whitelistedSales.push(address(Sale(new ArtSale(address(this), _payment, _price))));
        return RestStatus.OK;
    }

    function generateOwnershipHistory(
        string _seller,
        string _newOwner,
        uint _ownershipStartDate,
        address _itemAddress
    ) returns (uint) {
        if (ownerOrganization != getUserOrganization(tx.origin)) {
            return RestStatus.FORBIDDEN;
        }
        emit OwnershipUpdate(
            _seller,
            _newOwner,
            _ownershipStartDate,
            _itemAddress
        );
        return RestStatus.OK;
    }

    function resell(
        uint _price,
        PaymentType[] _paymentTypes
    ) returns (uint) {
        for (uint i = 0; i < _paymentTypes.length; i++) {
            createSale(_paymentTypes[i], _price);
        }  
        return RestStatus.OK;
    }

