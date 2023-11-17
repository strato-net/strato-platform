import "/dapp/dapp/contracts/Dapp.sol";
import "/dapp/items/contracts/ItemStatus.sol";
import "/dapp/orders/contracts/Sales/ClothingSale.sol";

pragma es6;
pragma strict;
import <d85f8ab0f5bb3add2046fd57ba9ba3ef3823d005>;

/// @title A representation of Clothing assets
contract Clothing is ItemStatus, RestStatus, Asset {
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public serialNumber;
    ItemStatus public status;
    uint public itemNumber;
    string public brand;

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
        string[] _images,
        uint _price,
        string _brand,
        SaleState _saleState,
        PaymentType _paymentType
    ) public Asset(_name, _description, _images, _createdDate){
        owner = _owner;

        serialNumber = _serialNumber;
        status = _status;
        itemNumber = _itemNumber;
        brand = _brand;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];

        createSale(_saleState, _paymentType);
    }

    function createSale(SaleState _state, PaymentType _payment) public requireOwner("Create sale") returns (uint) {// can be overridden
        whitelistedSales.push(address(new ClothingSale(address(this), _state, _payment)));
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