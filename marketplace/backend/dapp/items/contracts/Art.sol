import "/dapp/items/contracts/ItemStatus.sol";
import "/dapp/orders/contracts/Sales/ArtSale.sol";

pragma es6;
pragma strict;
import <d85f8ab0f5bb3add2046fd57ba9ba3ef3823d005>;

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
        SaleState _saleState,
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
            createSale(_saleState, _paymentTypes[i], _price);
         }
    }

    function createSale(SaleState _state, PaymentType _payment) public requireOwner("Create sale") returns (uint) {// can be overridden
        whitelistedSales.push(address(new ArtSale(address(this), _state, _payment)));
        return RestStatus.OK;
    }

    // Get the userOrganization
    function getUserOrganization(address caller) public returns (string) {
        mapping(string => string) ownerCert = getUserCert(caller);
        string userOrganization = ownerCert["organization"];
        return userOrganization;
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

    function reSell(
        uint _price,
        SaleState _saleState,
        PaymentType[] _paymentTypes
    ){
        for (uint i = 0; i < _paymentTypes.length; i++) {
            createSale(_saleState, _paymentTypes[i], price);
         }  
    }

